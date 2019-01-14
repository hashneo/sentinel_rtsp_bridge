'use strict';

module.exports.createStream = (req, res) => {

    let data = req.swagger.params.data.value;

    global.module.createStream(data)
        .then( (streamInfo) => {
            res.json( { data: streamInfo, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.deleteStream = (req, res) => {

    let id = req.swagger.params.id.value;

    global.module.deleteStream(id)
        .then( () => {
            res.json( { result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.getStreamData = (req, res) => {

    let id = req.swagger.params.id.value;

    global.module.getStreamData(id, req.originalUrl.replace(`/stream/${id}/`, ''))
        .then( (file) => {
            res.contentType('application/x-mpegURL');
            res.sendFile(file);
            //res.end();
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};
