// Copyright (c) 2018-2019, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

'use strict'

require('dotenv').config()
const cluster = require('cluster')
require('colors')
const Config = require('./config.json')
const cpuCount = Math.ceil(require('os').cpus().length / 8)
const Logger = require('./lib/logger')
const RabbitMQ = require('./lib/rabbit')
const TurtleCoind = require('turtlecoin-rpc').TurtleCoind

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
    Logger.warning('Node.js is not running in production mode. Consider running in production mode: export NODE_ENV=production')
  }

  Logger.log('Starting TurtlePay Blockchain Relay Agent...')

  for (var cpuThread = 0; cpuThread < cpuCount; cpuThread++) {
    spawnNewWorker()
  }

  cluster.on('exit', (worker, code, signal) => {
    Logger.error('Worker %s died', worker.process.pid)
    spawnNewWorker()
  })
} else if (cluster.isWorker) {
  const rabbit = new RabbitMQ(
    process.env.RABBIT_PUBLIC_SERVER || 'localhost',
    process.env.RABBIT_PUBLIC_USERNAME || '',
    process.env.RABBIT_PUBLIC_PASSWORD || '',
    false
  )

  rabbit.on('log', log => {
    Logger.log('[RABBIT] %s', log)
  })

  rabbit.on('connect', () => {
    Logger.log('[RABBIT] connected to server at %s', process.env.RABBIT_PUBLIC_SERVER || 'localhost')
  })

  rabbit.on('disconnect', (error) => {
    Logger.error('[RABBIT] lost connected to server: %s', error.toString())
    cluster.worker.kill()
  })

  rabbit.on('message', (queue, message, payload) => {
    /* If this is a transaction to relay, let's handle it */
    if (payload.rawTransaction) {
      var response

      /* Try to relay it to the daemon */
      return daemon.sendRawTransaction({
        tx: payload.rawTransaction
      })
        .then(resp => { response = resp })
        .then(() => { return rabbit.reply(message, response) })
        .then(() => {
        /* We got a response to the request, we're done here */
          if (response.status.toUpperCase() === 'OK') {
            Logger.info('Worker #%s relayed transaction [%s] via %s:%s [%s]', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port, response.status)
          } else {
            Logger.warning('Worker #%s relayed transaction [%s] via %s:%s [%s] %s', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port, response.status, response.error || '')
          }
        })
        .then(() => { return rabbit.ack(message) })
        .catch(error => {
        /* An error occurred */
          Logger.error('Worker #%s failed to relay transaction [%s] via %s:%s', cluster.worker.id, payload.hash, Config.daemon.host, Config.daemon.port)

          const reply = { error: error.toString() }

          return rabbit.reply(message, reply)
            .then(() => { return rabbit.ack(message) })
        })
    } else if (payload.blockBlob) {
      /* Try to relay it to the daemon */
      return daemon.submitBlock({
        blockBlob: payload.blockBlob
      })
        .then(response => { return rabbit.reply(message, response) })
        .then(() => Logger.info('Worker #%s submitted block [%s] via %s:%s', cluster.worker.id, payload.blockBlob, Config.daemon.host, Config.daemon.port))
        .then(() => { return rabbit.ack(message) })
        .catch(error => {
        /* An error occurred */
          Logger.error('Worker #%s failed to submit block [%s] via %s:%s', cluster.worker.id, payload.blockBlob, Config.daemon.host, Config.daemon.port)

          const reply = {
            error: error.toString()
          }

          return rabbit.reply(message, reply)
            .then(() => { return rabbit.ack(message) })
        })
    } else if (payload.walletAddress && payload.reserveSize) {
      /* Try to relay it to the daemon */
      return daemon.getBlockTemplate({
        walletAddress: payload.walletAddress,
        reserveSize: payload.reserveSize
      })
        .then(response => { return rabbit.reply(message, response) })
        .then(() => Logger.info('Worker #%s received blocktemplate for [%s] via %s:%s', cluster.worker.id, payload.walletAddress, Config.daemon.host, Config.daemon.port))
        .then(() => { return rabbit.ack(message) })
        .catch(error => {
          Logger.error('Worker #%s failed retrieve blocktemplate for [%s] via %s:%s', cluster.worker.id, payload.walletAddress, Config.daemon.host, Config.daemon.port)

          const reply = { error: error.toString() }

          return rabbit.reply(message, reply)
            .then(() => { return rabbit.ack(message) })
        })
    } else {
      return rabbit.nack(message)
    }
  })

  rabbit.connect()
    .then(() => { return rabbit.createQueue(Config.queues.relayAgent, true) })
    .then(() => { return rabbit.registerConsumer(Config.queues.relayAgent, 1) })
    .then(() => Logger.log('Worker #%s awaiting requests', cluster.worker.id))
    .catch(error => {
      Logger.error('Error in worker #%s: %s', cluster.worker.id, error.toString())
      cluster.worker.kill()
    })
}
