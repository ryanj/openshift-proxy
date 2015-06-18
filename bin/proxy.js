var httpProxy = require('http-proxy');
var proxy     = httpProxy.createProxyServer({secure: false});
var config    = require('./config')
//var LRU       = require("lru-cache")
//  , options   = { 
//      max: 1050
//    , length: function (n) { return n.length }
//  //, dispose: function (key, n) { revProxy.unregister(key) }
//    , maxAge: 60000 };
//var podCache = LRU(options);

proxy.on('close', function (req, socket, head) {
  // Alert when connections are dropped
  console.log('proxy connection dropped');
});
proxy.on('error',  function (error, req, res) {
  console.log('proxy error', error);
  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'application/json' });
  }
  var json = { error: 'proxy_error', reason: error.message };
  res.end(JSON.stringify(json));
});

function proxy_request(proxy, req, res, options){   console.log('PROXY req.url', req.url);
  console.log('PROXY req.url', req.url);
  console.log('PROXY options.target', options.target);
  proxy.web(req, res, options);
}

var path = function(req, res, next) {
  var namespace = req.params[0] || config.get('namespace');
  var podId = req.params[1];
  var filePath = req.params[2] || '';
  var pod_host = "https://"+config.get('openshift_server');
  req.url = '/api/v1beta3/namespaces/'+namespace+'/pods/'+ podId +'/proxy/'+filePath;
  req.headers.authorization = 'Bearer ' + config.get('oauth_token');
  //console.log("namespace, podid, filepath: " + namespace +" "+podId+" "+filePath)
  proxy.web(req, res, { target: pod_host });
};

var directPath = function(req, res, next){
  var namespace = config.get('namespace');
  var podIp = req.params[0];
  var filePath = req.params[1] || '';
  var pod_host = "http://"+podIp;
  req.url = filePath;
  proxy.web(req, res, { target: pod_host });
};

exports = module.exports = {
  'directPath': directPath,
  'path': path
};
