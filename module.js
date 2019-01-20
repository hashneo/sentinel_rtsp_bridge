'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    const ffmpeg = require('fluent-ffmpeg');
    const uuid = require('uuid');
    const path = require('path');
    const fs = require('fs-extra');

    let that = this;

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    let streams = {};

    let storagePath = process.env.STORAGE_PATH || (__dirname + `/streams`);

    this.createStream = (data) =>{

        return new Promise( (fulfill, reject) => {

            let alreadyDefined = false;
            Object.keys( streams ).forEach( (id) => {
                if ( streams[id][data.type].source === data.source ){
                    alreadyDefined = true;
                    if (fulfill)
                        fulfill( { id: id, endpoint: streams[id][data.type].endpoint } );
                }
            });

            if ( alreadyDefined )
                return;

            let id = uuid.v4();

            let streamPath = path.resolve( `${storagePath}/${data.type}/${id}/`);

            try {
                fs.removeSync(streamPath);
            }
            catch(e){}

            fs.mkdirsSync(streamPath);

            let outputFile = `${streamPath}/stream.m3u8`;

            if (data.type === 'image') {
                outputFile = `${streamPath}/data.jpg`;
            }

            function startStreamProcess( data, _fulfill, _reject ) {
                try {
                    let proc = ffmpeg(data.source, {timeout: 432000})
                        .inputOptions('-rtsp_transport', 'tcp' );
/*
                        .videoBitrate(1024)
                        .videoCodec('libx264')
                        .addOption('-profile:v', 'main')
                        .audioCodec('aac')
                        .audioBitrate('48k')
*/

                    if (data.type === 'live') {
                        proc
                            .videoCodec('copy')
                            .audioCodec('copy')

                            .addOption('-hls_init_time', 2)
                            .addOption('-hls_time', 2)
                            .addOption('-hls_list_size', 10)
                            .addOption('-hls_flags', 'split_by_time')
                            .addOption('-hls_flags', 'delete_segments')
                            .addOption('-pix_fmt', 'yuv420p');
                    } else {
                        proc
                            .addOption('-update', '1')
                            .addOption('-y')
                            .addOption('-f' , 'image2')
                            .addOption('-r', '2' );
                    }

                    proc
                        .on('start', function (commandLine) {

                            console.log(commandLine);

                            let i = 10000;

                            function waitForFile() {
                                fs.stat(outputFile, (err, stats) => {
                                    if (stats) {
                                        streams[id] = {};
                                        streams[id][data.type] = {
                                            source: data.source,
                                            lastAccess: new Date().getTime(),
                                            proc: proc
                                        };

                                        if (data.type === 'live')
                                            streams[id][data.type]['endpoint'] =  `/stream/${id}/live/stream.m3u8`;
                                        else
                                            streams[id][data.type]['endpoint'] =  `/stream/${id}/image/data.jpg`;

                                        if (_fulfill)
                                            _fulfill( { id: id, endpoint: streams[id][data.type].endpoint } );

                                        return;
                                    }
                                    if (--i <= 0) {
                                        _reject(new Error('timeout'));
                                        proc.kill();
                                        return;
                                    }
                                    setTimeout(waitForFile, 100);
                                });
                            }

                            setTimeout(waitForFile, 100);
                        })
                        .on('end', function () {
                            startStreamProcess(data, null, () => {
                                delete streams[id][data.type];
                            });
                        })
                        .on('error', function (err) {
                            delete streams[id][data.type];
                            fs.removeSync(streamPath);
                            if (!err.message.includes('SIGKILL')){
                                console.log(err);
                            }else{

                            }
                            _reject(err);
                        })
                        .save(outputFile);
                }
                catch(err){
                    console.log(err);
                    fs.removeSync(streamPath);
                    delete streams[id];
                    _reject(err);
                }
            }

            startStreamProcess( data, fulfill, reject );
        });

    };

    this.deleteStream = (id, type) =>{

        return new Promise( (fulfill, reject) => {
            if (!streams[id])
                return reject( {code: 404, message: 'not found' } );

            if (!streams[id][type])
                return reject( {code: 404, message: 'not found' } );

            try {
                streams[id][type].proc.kill();
                fulfill();
            }
            catch(err){
                reject(err);
            }

        });

    };

    this.getStreamData = (id, type, resource) =>{
        return new Promise( (fulfill, reject) => {
            if (!streams[id])
                return reject( {code: 404, message: 'not found' } );

            if (!streams[id][type])
                return reject( {code: 404, message: 'not found' } );

            streams[id][type].lastAccess = new Date().getTime();

            fulfill( path.normalize( `${storagePath}/${type}/${id}/${resource}`) );
        });

    };

    function watchDog(){
        let _now = new Date().getTime();
        Object.keys( streams ).forEach( (id) => {
            Object.keys( streams[id] ).forEach( (type) => {
                try {
                    let diff = _now - streams[id][type].lastAccess;

                    if (diff > (5 * 60000)) {
                        streams[id][type].proc.kill();
                    }
                } catch (err) {
                }
            });
        });
    }

    setInterval( watchDog, 10000 );
}

module.exports = _module;