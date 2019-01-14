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
                if ( streams[id].source === data.source ){
                    alreadyDefined = true;
                    if (fulfill)
                        fulfill( { id: id, endpoint: streams[id].endpiont } );
                }
            });

            if ( alreadyDefined )
                return;

            let id = uuid.v4();

            let streamPath = path.resolve( `${storagePath}/${id}/`);

            try {
                fs.removeSync(streamPath);
            }
            catch(e){}

            fs.mkdirSync(streamPath, true);

            let m3u8 = `${streamPath}/stream.m3u8`;

            function startStreamProcess( data, _fulfill, _reject ) {
                try {
                    let proc = ffmpeg(data.source, {timeout: 432000})
                        //.videoBitrate(1024)
/*
                        .videoCodec('libx264')
                        .addOption('-profile:v', 'baseline')
                        .audioCodec('libmp3lame')
                        .audioBitrate('128k')
*/
                        .videoCodec('copy')
                        .audioCodec('copy')
                        .addOption('-hls_init_time', 2)
                        .addOption('-hls_time', 2)
                        .addOption('-hls_list_size', 10)
                        .addOption('-hls_flags', 'split_by_time')
                        .addOption('-hls_flags', 'delete_segments')
                        .addOption('-pix_fmt', 'yuv420p')

                        //.addOption('-hls_flags', 'single_file' )
                        // setup event handlers
                        .on('start', function (commandLine) {
                            let i = 100;

                            function waitForFile() {
                                fs.stat(m3u8, (err, stats) => {
                                    if (stats) {
                                        streams[id] = {
                                            source: data.source,
                                            endpoint: `/stream/${id}/stream.m3u8`,
                                            lastAccess: new Date().getTime(),
                                            proc: proc
                                        };

                                        if (_fulfill)
                                            _fulfill( { id: id, endpoint: streams[id].endpoint } );

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
                                delete streams[id];
                            });
                        })
                        .on('error', function (err) {
                            fs.removeSync(streamPath);
                            delete streams[id];
                            _reject(err);
                        })
                        .save(m3u8);
                }
                catch(err){
                    fs.removeSync(streamPath);
                    delete streams[id];
                    _reject(err);
                }
            }

            startStreamProcess( data, fulfill, reject );
        });

    };

    this.deleteStream = (id) =>{

        return new Promise( (fulfill, reject) => {

            if (!streams[id]){
                return reject( {code: 404, message: 'not found' } );
            }

            try {
                streams[id].proc.kill();
                fulfill();
            }
            catch(err){
                reject(err);
            }

        });

    };

    this.getStreamData = (id, resource) =>{
        return new Promise( (fulfill, reject) => {
            streams[id].lastAccess = new Date().getTime();
            fulfill( path.normalize( `${streamPath}/${id}/${resource}`) );
        });

    };

    function watchDog(){
        let _now = new Date().getTime();
        Object.keys( streams ).forEach( (id) => {
            try {
                if (_now - streams[id].lastAccess > 60000) {
                    streams[id].proc.kill();
                }
            }catch(err){
            }
        });
    }

    setInterval( watchDog, 10000 );
}

module.exports = _module;