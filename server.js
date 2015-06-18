'use strict'

var http = require('http')
  , httpProxy = require('http-proxy')
  , url = require('url')
  , listWatch = require('./list-watch')
  , Rx = require('rx')
  ;

http.globalAgent.maxSockets = Infinity;

var podCache = {};

var proxy = httpProxy.createProxyServer({secure: false});

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

console.log('config', config);

var listWatchConfig = {
  name: 'Proxy Listwatch'
, listOptions: {
    method : 'get'
  , url : config.openshiftServer + '/api/v1beta3/namespaces/' + config.namespace + '/pods'
  , rejectUnauthorized: false
  , strictSSL: false
  , auth: {bearer: config.token}
  , qs: {}
  }
, watchOptions: {
    method : 'get'
  , url: config.openshiftServer + '/api/v1beta3/watch/namespaces/' + config.namespace + '/pods'
  , rejectUnauthorized: false
  , strictSSL: false
  , auth: {bearer:  config.token}
  , qs: {}
  }
, state: {pods: {}}
}

// console.log(listWatchConfig)

var parsePod = function(update) {
  if (! (update && update.object && update.object.spec && update.object.spec.containers && update.object.spec.containers.length > 0)) {
    return update;
  };
  var containerName = update.object.spec.containers[0].name;
  if (containerName.indexOf('sketchpod') !== 0 || !update.object.status || !update.object.status.phase) {
    // console.log(tag, 'Ignoring update for container name:', update.object.spec.containers[0].name);
  } else {
    var podName = update.object.metadata.name;
    if (update.type === 'DELETED') {
      console.log('Removing',podName,'from the cache');
      delete podCache[podName];
    } else if (update.object.status.podIP && update.object.spec.containers[0].ports && update.object.spec.containers[0].ports.length > 0 && update.object.spec.containers[0].ports[0].containerPort) {
      var podIp = update.object.status.podIP;
      var containerPort = update.object.spec.containers[0].ports[0].containerPort;
      var containerUrl = "http://" + podIp + ":" + containerPort;
      if (podCache[podName] != containerUrl) {
        console.log('Addind',podName,'to the cache');
        podCache[podName] = containerUrl;
      }
    }
  }
  return update;
};

listWatch.list(listWatchConfig).tap(function(pod) {
  parsePod(pod);
})
.tapOnError(function(err) {
  console.log(error);
})
.catch(Rx.Observable.empty)
.subscribe(function() {
  // no-op
});

var re = /^\/([a-z0-9\-]*)\/([a-z0-9\-]*)/;

function proxy_request(proxy, req, res, options){
  console.log('PROXY req.url', req.url);
  console.log('PROXY options.target', options.target);
  proxy.web(req, res, options);
}

var server = http.createServer(function(req, res) {
  var containerUrl;
  console.log("*******************************************************************************");
  // console.log("req.url", req.url);
  if (req.url.indexOf('/'+config.namespace) !== 0) {
    console.log('Ignoring request:', req.url)
  } else {
    var parsed = url.parse(req.url);
    var results = parsed.pathname.match(re);
    if (results) {
      var origPath = req.url.substring(results[0].length);
      var namespace = results[1];
      var podName = results[2];
      var resourceUrl = req.url.substring(results[0].length);
      var lastSlash = resourceUrl.lastIndexOf('/');
      var newPath = ''; //lastSlash === -1 ? '' : resourceUrl.substring(0, lastSlash);
      // console.log("headers: ", req.headers)
      // console.log("parsed: ", parsed)
      // console.log("origPath: ", origPath)
      // console.log("namespace: ", namespace)
      // console.log("pod: ", pod)
      // console.log("newPath: ", newPath)
      req.url = resourceUrl;
      //var cacheKey = "http://" + req.headers.host + "/" + namespace + "/" + pod;
      containerUrl = podCache[podName];
      if (!!containerUrl) {
        // console.log("Using cached value: " + containerUrl + " for: " + cacheKey);
        proxy_request(proxy, req, res, { target: containerUrl, prependPath: true, ignorePath: false });
      } else {
        console.log('No listwatch information for pod', podName);
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

// Rx.Observable.interval(10000).subscribe(function() {
//   console.log('podCache', podCache);
// })

console.log('listening on', config.hostname, ':', config.port)
server.listen(config.port, config.hostname);
