'use strict'

var restify = require('restify');

var http = require('http')
  , httpProxy = require('http-proxy')
  , url = require('url')
  ;

http.globalAgent.maxSockets = Infinity;


var proxy = httpProxy.createProxyServer({secure: false});
//var revProxy = require('redbird')({port: 8081});
//var revProxyUrl = "http://localhost:8081";

var LRU = require("lru-cache")
  , options = { max: 1050
  , length: function (n) { return n.length }
  //, dispose: function (key, n) { revProxy.unregister(key) }
  , maxAge: 60000 }
  , podCache = LRU(options)
  ;

  proxy.on('error', function (error, req, res) {
    console.log('proxy error', error);
    if (res) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      var json = { error: 'proxy_error', reason: error.message };
      res.end(JSON.stringify(json));
    }
  });

  var config = {
    openshiftServer: 'https://' + (process.env.OPENSHIFT_SERVER || 'openshift-master.summit.paas.ninja:8443')
  , port: process.env.OPENSHIFT_NODEJS_PORT || 8080
  , hostname: process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0'
  , token: process.env.ACCESS_TOKEN || ''
  , namespace: process.env.NAMESPACE || 'test3'
  };

  var re = /^\/([a-z0-9\-]*)\/([a-z0-9\-]*)/;

  function proxy_request(proxy, req, res, options){
    console.log('PROXY req.url', req.url);
    console.log('PROXY options.target', options.target);
    proxy.web(req, res, options);
  }

  function proxyToPod(req, res) {

  }

  var server = http.createServer(function(req, res) {
    var containerUrl;
    console.log("*******************************************************************************");
    console.log("req.url", req.url);
    if (req.url.indexOf('/'+config.namespace) !== 0) {
      containerUrl = podCache.get('test3/sketchpod-1-k8wj0');
      proxy_request(proxy, req, res, { target: containerUrl, prependPath: true, ignorePath: true });
    } else {
      var parsed = url.parse(req.url);
      var results = parsed.pathname.match(re);
      if (results) {
        var origPath = req.url.substring(results[0].length);
        var namespace = results[1];
        var pod = results[2];
        var resourceUrl = req.url.substring(results[0].length);
        var lastSlash = resourceUrl.lastIndexOf('/');
        var newPath = lastSlash === -1 ? '' : resourceUrl.substring(0, lastSlash);
        console.log("headers: ", req.headers)
        console.log("parsed: ", parsed)
        console.log("origPath: ", origPath)
        console.log("namespace: ", namespace)
        console.log("pod: ", pod)
        console.log("newPath: ", newPath)
        //var cacheKey = "http://" + req.headers.host + "/" + namespace + "/" + pod;
        var cacheKey = namespace + "/" + pod;
        containerUrl = podCache.get(cacheKey);
        if (!!containerUrl) {
          console.log("Using cached value: " + containerUrl + " for: " + cacheKey);
          //proxy_request(proxy, req, res, { target: revProxyUrl });
          proxy_request(proxy, req, res, { target: containerUrl + newPath, prependPath: false, ignorePath: true });
        } else {
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
              console.log("Error querying api: ", err);
            } else {
              var podIp = obj.status.podIP;
              var containerPort = obj.spec.containers[0].ports[0].containerPort;
              var containerUrl = "http://" + podIp + ":" + containerPort;
              console.log("Caching value: " + containerUrl + " for: " + cacheKey);
              podCache.set(cacheKey, containerUrl);
              //revProxy.register(cacheKey, containerUrl);
              //proxy_request(proxy, req, res, { target: revProxyUrl });
              proxy_request(proxy, req, res, { target: containerUrl + newPath, prependPath: false, ignorePath: true });
            }
          });
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
