# NamCoin: Blockchain Relay Agent
![Version](https://img.shields.io/badge/version-0.0.1-blue.svg?cacheSeconds=2592000) ![Prerequisite](https://img.shields.io/badge/node-%3E%3D6-blue.svg) [![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/TurtlePay/blockchain-relay-agent/graphs/commit-activity) [![License: AGPL-3.0](https://img.shields.io/badge/license-AGL--3.0-yellow.svg)](https://github.com/TurtlePay/blockchain-relay-agent/blob/master/LICENSE)

> RabbitMQ agent that relays information to/from NamCoind to interact with the NamCoin network.

## Prerequisites

- node >=6
- RabbitMQ >= 3.7.9

## Install

```sh
npm install
```

## Usage

1) Use your favorite text editor to change the values as necessary in `config.json`

```javascript
{
  "daemon": {
    "host": "localhost",
    "port": 11778
  },
  "queues": {
    "relayAgent": "request.network"
  }
}
```

2) Set your environment variables and start the service up

```sh
export RABBIT_PUBLIC_SERVER=localhost
export RABBIT_PUBLIC_USERNAME=yourrabbitmqusername
export RABBIT_PUBLIC_PASSWORD=yourrabbitmqpassword
npm start
```

## Run tests

```sh
npm test
```

## Author

👤 **TurtlePay® Development Team**

* Twitter: [@TurtlePay](https://twitter.com/TurtlePay)
* Github: [@TurtlePay](https://github.com/TurtlePay)

## 🤝 Contributing

Contributions, issues and feature requests are welcome!

Feel free to check [issues page](https://github.com/TurtlePay/blockchain-relay-agent/issues).

## Show your support

Give a ⭐️ if this project helped you!


## 📝 License

Copyright © 2018-2019 [TurtlePay® Development Team](https://github.com/TurtlePay).

This project is [AGPL-3.0](https://github.com/TurtlePay/blockchain-relay-agent/blob/master/LICENSE) licensed.
