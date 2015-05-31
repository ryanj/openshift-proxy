'use strict'

var http = require('http')
  , httpProxy = require('http-proxy')
  ;

var proxy = httpProxy.createProxyServer({secure: false});

var token = process.env.ACCESS_TOKEN || '';

var server = http.createServer(function(req, res) {
  req.headers.authorization = 'Bearer ' + token;
  proxy.web(req, res, { target: 'https://openshift-master.summit.paas.ninja:8443' });
});

console.log("listening on port 5050")
server.listen(5050);
