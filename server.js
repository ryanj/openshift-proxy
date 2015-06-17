'use strict'

var restify = require('restify');

var http = require('http')
  , httpProxy = require('http-proxy')
  , url = require('url')
  ;

http.globalAgent.maxSockets = Infinity;


var proxy = httpProxy.createProxyServer({secure: false});
var revProxy = require('redbird')({port: 8081});
var revProxyUrl = "http://localhost:8081";

var LRU = require("lru-cache")
  , options = { max: 1050
              , length: function (n) { return n.length }
	      , dispose: function (key, n) { revProxy.unregister(key, n) }
              , maxAge: 1000 }
  , podCache = LRU(options)
  ;

proxy.on('error', function (error, req, res) {
  console.log('proxy error', error);
  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'application/json' });
  }
  var json = { error: 'proxy_error', reason: error.message };
  res.end(JSON.stringify(json));
});

var config = {
  openshiftServer: 'https://' + (process.env.OPENSHIFT_SERVER || 'openshift-master.summit.paas.ninja:8443')
, port: process.env.OPENSHIFT_NODEJS_PORT || 8080
, hostname: process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0'
, token: process.env.ACCESS_TOKEN || ''
};

var re = /^\/([a-z0-9\-]*)\/([a-z0-9\-]*)/;

function proxy_request(proxy, req, res, options){
  proxy.web(req, res, options);
}

var server = http.createServer(function(req, res) {
  if (req.url.indexOf('/api/v1beta3/namespaces/') == 0) {
    proxy_request(proxy, req, res, { target: config.openshiftServer });
  } else {
    var parsed = url.parse(req.url);
    console.log("parsed: ", parsed)
    var results = parsed.pathname.match(re);
    var origPath = req.url.substring(results[0].length);
    console.log("origPath: ", origPath)
    var namespace = results[1];
    console.log("namespace: ", namespace)
    var pod = results[2];
    console.log("pod: ", pod)
    var newPath = results.slice(3).join('/')
    console.log("newPath: ", newPath)
    if (results) {
      var cacheKey = "localhost/" + namespace + "/" + pod;
      var containerUrl = podCache.get(cacheKey);
      if (!containerUrl) {
        var client = restify.createJsonClient({
          url: config.openshiftServer,
          rejectUnauthorized: false,
          headers: {
            authorization: "Bearer " + config.token
          }
        });
        var podPath = "/api/v1beta3/namespaces/" + namespace + "/pods/" + pod;
	var podUrl = config.openshiftServer + podPath
        console.log("podUrl: ", podUrl)
        client.get(podUrl, function(err, c_req, c_res, obj) {
          if (err instanceof Error) {
            console.log("Error querying api: ", err)
            console.log("Failing back to kube proxy");
            var apiPath = podPath +'/proxy';
            req.url = apiPath + origPath;
  	    req.headers.authorization = 'Bearer ' + config.token;
            console.log(req.url);
            proxy_request(proxy, req, res, { target: config.openshiftServer });
          } else {
            var podIp = obj.status.podIP;
            var containerPort = obj.spec.containers[0].ports[0].containerPort;
            var containerUrl = "http://" + podIp + ":" + containerPort;
            console.log("Caching value: " + containerUrl + " for: " + cacheKey);
            podCache.set(cacheKey, containerUrl);
	    revProxy.register(cacheKey, containerUrl);
	    proxy_request(proxy, req, res, { target: revProxyUrl });
          }
        });
      } else {
        console.log("Using cached value: " + containerUrl + " for: " + cacheKey);
	proxy_request(proxy, req, res, { target: revProxyUrl });
      }

    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<html><body><h3>Invalid url.</h3><p>Specify a correct namespace and pod name in the URL as in:</p>');
      res.write('<p>http://1k.jbosskeynote.com/{namespace}/{pod_name}</p>');
      res.end();
      return;
    }
  };

});

console.log('listening on', config.hostname, ':', config.port)
server.listen(config.port, config.hostname);
