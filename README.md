# Mida cTrader
[![Image](https://img.shields.io/npm/v/@reiryoku/mida-ctrader)](https://www.npmjs.com/package/@reiryoku/mida-ctrader)
[![Image](https://img.shields.io/npm/l/@reiryoku/mida-ctrader)](LICENSE)
[![Image](https://img.shields.io/discord/780532638846287904?label=community)](https://discord.gg/cKyWTUsr3q)
<br>

A [Mida](https://github.com/Reiryoku-Technologies/Mida) plugin to operate with cTrader.

## Usage
### Broker account login
How to login into a cTrader broker account.
```javascript
const { Mida, MidaBroker, } = require("@reiryoku/mida");

// Use the Mida cTrader plugin
Mida.use(require("@reiryoku/mida-ctrader"));

// Login into any cTrader broker account
const myAccount = await MidaBroker.login("cTrader", {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    cTraderBrokerAccountId: "",
});
```

## Documentation
For the complete documentation refer to [Mida](https://github.com/Reiryoku-Technologies/Mida).
