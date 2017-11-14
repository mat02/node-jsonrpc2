import * as rpc from '../lib';

function printError(err){
  console.error('RPC Error: [' + err.name + ']: ' + JSON.stringify(err));
}

/*
 Connect to HTTP server
 */
const client = new rpc.Client(8088, 'localhost', new rpc.Auth.UserPass('myuser', 'secret123'));

async function HTTP() {
  client.call('add', [1, 2], function (err, result){
    if (err) {
      return printError(err);
    }
    console.log('  1 + 2 = ' + result + ' (http)');
  });

  client.call('multiply', [199, 2], function (err, result){
    if (err) {
      return printError(err);
    }
    console.log('199 * 2 = ' + result + ' (http)');
  });

  // These calls should each take 1.5 seconds to complete
  client.call('delayed.echo', ['Echo.', 1500], function (err, result){
    if (err) {
      return printError(err);
    }
    console.log('  ' + result + ', delay 1500 ms' + ' (http)');
  });
}

HTTP()

/*
 Connect to Raw socket server
 */
const socketClient = new rpc.Client(8089, 'localhost', new rpc.Auth.UserPass('myuser', 'secret123'));

async function SOCKET() {
  socketClient.connectSocket(function (err, conn){
    if (err) {
      return printError(err);
    }

    if (conn) {
      // Accessing modules is as simple as dot-prefixing.
      conn.call('math.power', [3, 3], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  3 ^ 3 = ' + result + ' (socket)');
      });

      // These calls should each take 1 seconds to complete
      conn.call('delayed.add', [1, 1, 1000], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  1 + 1 = ' + result + ', delay 1000 ms (socket)');
      });

      conn.call('delayed.echo', ['echo back 0 timeout', 0], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  ' + result + ' (socket)');
      });
    }
  });

  /*
   Connect to Websocket server
   */
  var WebsocketClient = new rpc.Client(8088, 'localhost', new rpc.Auth.UserPass('myuser', 'secret123'));

  WebsocketClient.connectWebsocket(function (err, conn){
    if (err) {
      return printError(err);
    }

    if (conn) {
      // Accessing modules is as simple as dot-prefixing.
      conn.call('math.power', [64, 2], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  64 ^ 2 = ' + result + ' (websocket)');
      });

      // These calls should each take 1 seconds to complete
      conn.call('delayed.add', [155, 155, 4000], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  155 + 155 = ' + result + ', delay 4000 ms (websocket)');
      });

      conn.call('delayed.echo', ['echo back 0 timeout', 0], function (err, result){
        if (err) {
          return printError(err);
        }
        console.log('  ' + result + ' (websocket)');
      });
    }
  });
}

SOCKET()