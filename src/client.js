module.exports = function (classes){
  'use strict';

  var
    net = require('net'),
    http = require('http'),
    https = require('https'),
    WebSocket = classes.Websocket,
    JsonParser = require('jsonparse'),
    EventEmitter = classes.EventEmitter,
    Endpoint = classes.Endpoint,
    _ = classes._,
    SocketConnection = classes.SocketConnection,
    WebSocketConnection = classes.WebSocketConnection,
    /**
     * JSON-RPC Client.
     */
      Client = Endpoint.$define('Client', {
      construct    : function ($super, port, host, user, password){
        $super();

        this.port = port;
        this.host = host;
        this.user = user;
        this.password = password;
        this.on('error', () => {});
      },
      _authHeader: function(headers){
        if (this.user && this.password) {
          var buff = Buffer.from(this.user + ':' + this.password).toString('base64');
          headers['Authorization'] = 'Basic ' + buff;
        }
      },
      /**
       * Make HTTP connection/request.
       *
       * In HTTP mode, we get to submit exactly one message and receive up to n
       * messages.
       */
      connectHttp  : function (method, params, opts, callback){
        if (_.isFunction(opts)) {
          callback = opts;
          opts = {};
        }
        opts = opts || {};

        var id = 1, self = this;

        // First we encode the request into JSON
        var requestJSON = JSON.stringify({
          'id'     : id,
          'method' : method,
          'params' : params,
          'jsonrpc': '2.0'
        });

        var headers = {};

        this._authHeader(headers);

        // Then we build some basic headers.
        headers['Host'] = this.host;
        headers['Content-Type'] = 'application/json-rpc';
        headers['Content-Length'] = Buffer.byteLength(requestJSON, 'utf8');

        // Now we'll make a request to the server
        var options = {
          hostname: this.host,
          port    : this.port,
          path    : opts.path || '/',
          method  : 'POST',
          headers : headers
        };
        var request;
        if(opts.https === true) {
          if(opts.rejectUnauthorized !== undefined) {
            options.rejectUnauthorized = opts.rejectUnauthorized;
          }
          request = https.request(options);
        } else {
          request = http.request(options);
        }


        // Report errors from the http client. This also prevents crashes since
        // an exception is thrown if we don't handle this event.
        request.on('error', function requestError(err){
          callback(err);
        });
        request.write(requestJSON);
        request.on('response', function requestResponse(response){
          callback.call(self, id, request, response);
        });
      },
      connectWebsocket: function(callback){
        var self = this, conn, socket, parser, headers = {};

        if (!/^wss?:\/\//i.test(self.host)) {
          self.host = 'ws://' + self.host + ':' + self.port + '/';
        }

        this._authHeader(headers);

        socket = new WebSocket.Client(self.host, null, {headers: headers});

        conn = new WebSocketConnection(self, socket);

        parser = new JsonParser();

        parser.onValue = function parseOnValue(decoded){
          if (this.stack.length) {
            return;
          }

          conn.handleMessage(decoded);
        };

        socket.on('error', function socketError(event){
          callback(event.reason);
        });

        socket.on('open', function socketOpen(){
          callback(null, conn);
        });

        socket.on('message', function socketMessage(event){
          try {
            parser.write(event.data);
          } catch (err) {
            EventEmitter.trace('<--', err.toString());
          }
        });

        return conn;
      },
      /**
       * Make Socket connection.
       *
       * This implements JSON-RPC over a raw socket. This mode allows us to send and
       * receive as many messages as we like once the socket is established.
       */
      connectSocket: function (callback){
        var self = this, socket, conn, parser;

        socket = net.connect(this.port, this.host, function netConnect(){
          // Submit non-standard 'auth' message for raw sockets.
          if (!_.isEmpty(self.user) && !_.isEmpty(self.password)) {
            conn.call('auth', [self.user, self.password], function connectionAuth(err){
              if (err) {
                callback(err);
              } else {
                callback(null, conn);
              }
            });
            return;
          }

          if (_.isFunction(callback)) {
            callback(null, conn);
          }
        });

        conn = new SocketConnection(self, socket);
        parser = new JsonParser();

        parser.onValue = function parseOnValue(decoded){
          if (this.stack.length) {
            return;
          }

          conn.handleMessage(decoded);
        };

        socket.on('data', function socketData(chunk){
          try {
            parser.write(chunk);
          } catch (err) {
            EventEmitter.trace('<--', err.toString());
          }
        });

        return conn;
      },
      stream       : function (method, params, opts, callback){
        if (_.isFunction(opts)) {
          callback = opts;
          opts = {};
        }
        opts = opts || {};

        this.connectHttp(method, params, opts, function connectHttp(id, request, response){
          if (_.isFunction(callback)) {
            var connection = new EventEmitter();

            connection.id = id;
            connection.req = request;
            connection.res = response;

            connection.expose = function connectionExpose(method, callback){
              connection.on('call:' + method, function connectionCall(data){
                callback.call(null, data.params || []);
              });
            };

            connection.end = function connectionEnd(){
              this.req.connection.end();
            };

            // We need to buffer the response chunks in a nonblocking way.
            var parser = new JsonParser();
            parser.onValue = function (decoded){
              if (this.stack.length) {
                return;
              }

              connection.emit('data', decoded);
              if (
                decoded.hasOwnProperty('result') ||
                  decoded.hasOwnProperty('error') &&
                    decoded.id === id && _.isFunction(callback)
                ) {
                connection.emit('result', decoded);
              }
              else if (decoded.hasOwnProperty('method')) {
                connection.emit('call:' + decoded.method, decoded);
              }
            };

            if (response) {
              // Handle headers
              connection.res.once('data', function connectionOnce(data){
                if (connection.res.statusCode === 200) {
                  callback(null, connection);
                } else {
                  callback(new Error('"' + connection.res.statusCode + '"' + data));
                }
              });

              connection.res.on('data', function connectionData(chunk){
                try {
                  parser.write(chunk);
                } catch (err) {
                  // TODO: Is ignoring invalid data the right thing to do?
                }
              });

              connection.res.on('end', function connectionEnd(){
                // TODO: Issue an error if there has been no valid response message
              });
            }
          }
        });
      },
      call         : function (method, params, opts, callback){
        if (_.isFunction(opts)) {
          callback = opts;
          opts = {};
        }
        opts = opts || {};
        EventEmitter.trace('-->', 'Http call (method ' + method + '): ' + JSON.stringify(params));

        this.connectHttp(method, params, opts, function connectHttp(id, request, response){
          // Check if response object exists.
          if (!response) {
            callback(new Error('Have no response object'));
            return;
          }

          var data = '';

          response.on('data', function responseData(chunk){
            data += chunk;
          });

          response.on('end', function responseEnd(){
            if (response.statusCode !== 200) {
              callback(new Error('"' + response.statusCode + '"' + data))
              ;
              return;
            }
            var decoded = JSON.parse(data);
            if (_.isFunction(callback)) {
              if (!decoded.error) {
                decoded.error = null;
              }
              callback(decoded.error, decoded.result);
            }
          });
        });
      }
    });

  return Client;
};
