// Copyright (c) 2018-2019, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

'use strict'

require('dotenv').config()
const cluster = require('cluster')
require('colors')
const Config = require('./config.json')
const cpuCount = Math.ceil(require('os').cpus().length / 8)
const Helpers = require('./lib/helpers.js')
const RabbitMQ = require('./lib/rabbit.js')
const TurtleCoind = require('turtlecoin-rpc').TurtleCoind
const util = require('util')

const daemon = new TurtleCoind({
  host: Config.daemon.host,
  port: Config.daemon.port,
  timeout: Config.daemon.timeout
})

function spawnNewWorker () {
  cluster.fork()
}

if (cluster.isMaster) {
  if (!process.env.NODE_ENV || process.env.NODE_ENV.toLowerCase() !== 'production') {
    Helpers.log('[WARNING] Node.js is not running in production mode. Consider running in production mode: export NODE_ENV=production'.yellow)
  }

  Helpers.log('Starting TurtlePay Blockchain Relay Agent...')

  for (var cpuThread = 0; cpuThread < cpuCount; cpuThread++) {
    spawnNewWorker()
  }

  cluster.on('exit', (worker, code, signal) => {
    Helpers.log(util.format('worker %s died', worker.process.pid))
    spawnNewWorker()
  })
} else if (cluster.isWorker) {
  const rabbit = new RabbitMQ(process.env.RABBIT_PUBLIC_SERVER || 'localhost', process.env.RABBIT_PUBLIC_USERNAME || '', process.env.RABBIT_PUBLIC_PASSWORD || '', false)

  rabbit.on('log', log => {
    Helpers.log(util.format('[RABBIT] %s', log))
  })

  rabbit.on('connect', () => {
    Helpers.log(util.format('[RABBIT] connected to server at %s', process.env.RABBIT_PUBLIC_SERVER || 'localhost'))
  })

  rabbit.on('disconnect', (error) => {
    Helpers.log(util.format('[RABBIT] lost connected to server: %s', error.toString()))
    cluster.worker.kill()
  })

  rabbit.on('message', (queue, message, payload) => {
    /* If this is a transaction to relay, let's handle it */
    if (payload.rawTransaction) {
      var response

      /* Try to relay it to the daemon */
      daemon.sendRawTransaction({
        tx: payload.rawTransaction
      }).then((resp) => {
        response = resp
        return rabbit.sendToQueue(message.properties.replyTo, response, {
          correlationId: message.properties.correlationId
        })
      }).then(() => {
        /* We got a response to the request, we're done here */
        if (response.status.toUpperCase() === 'OK') {
          Helpers.log(util.format('[INFO] Worker #%s relayed transaction [%s] via %s:%s [%s]', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port, response.status).green)
        } else {
          Helpers.log(util.format('[INFO] Worker #%s relayed transaction [%s] via %s:%s [%s] %s', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port, response.status, response.error || '').red)
        }
        return rabbit.ack(message)
      }).catch((error) => {
        /* An error occurred */
        Helpers.log(util.format('[INFO] Worker #%s failed to relay transaction [%s] via %s:%s', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port).yellow)

        const reply = {
          error: error.toString()
        }

        rabbit.sendToQueue(message.properties.replyTo, reply, {
          correlationId: message.properties.correlationId
        })

        return rabbit.ack(message)
      })
    } else if (payload.blockBlob) {
      /* Try to relay it to the daemon */
      daemon.submitBlock({
        blockBlob: payload.blockBlob
      }).then((response) => {
        return rabbit.sendToQueue(message.properties.replyTo, response, {
          correlationId: message.properties.correlationId
        })
      }).then(() => {
        /* We got a response to the request, we're done here */
        Helpers.log(util.format('[INFO] Worker #%s submitted block [%s] via %s:%s', cluster.worker.id, payload.blockBlob, Config.daemon.host, Config.daemon.port).green)
        return rabbit.ack(message)
      }).catch((error) => {
        /* An error occurred */
        Helpers.log(util.format('[INFO] Worker #%s failed to submit block [%s] via %s:%s', cluster.worker.id, payload.blockBlob, Config.daemon.host, Config.daemon.port).red)

        const reply = {
          error: error.toString()
        }

        rabbit.sendToQueue(message.properties.replyTo, reply, {
          correlationId: message.properties.correlationId
        })

        return rabbit.ack(message)
      })
    } else if (payload.walletAddress && payload.reserveSize) {
      /* Try to relay it to the daemon */
      daemon.getBlockTemplate({
        walletAddress: payload.walletAddress,
        reserveSize: payload.reserveSize
      }).then((response) => {
        return rabbit.sendToQueue(message.properties.replyTo, payload, {
          correlationId: message.properties.correlationId
        })
      }).then(() => {
        Helpers.log(util.format('[INFO] Worker #%s received blocktemplate for [%s] via %s:%s', cluster.worker.id, payload.walletAddress, Config.daemon.host, Config.daemon.port).green)
        return rabbit.ack(message)
      }).catch((error) => {
        Helpers.log(util.format('[INFO] Worker #%s failed retrieve blocktemplate for [%s] via %s:%s', cluster.worker.id, payload.walletAddress, Config.daemon.host, Config.daemon.port).red)

        const reply = {
          error: error.toString()
        }

        rabbit.sendToQueue(message.properties.replyTo, reply, {
          correlationId: message.properties.correlationId
        })

        return rabbit.ack(message)
      })
    } else {
      return rabbit.nack(message)
    }
  })

  rabbit.connect().then(() => {
    return rabbit.createQueue(Config.queues.relayAgent, true)
  }).then(() => {
    return rabbit.registerConsumer(Config.queues.relayAgent, 1)
  }).then(() => {
    Helpers.log(util.format('Worker #%s awaiting requests', cluster.worker.id))
  }).catch((error) => {
    Helpers.log(util.format('Error in worker #%s: %s', cluster.worker.id, error.toString()))
    cluster.worker.kill()
  })
}
