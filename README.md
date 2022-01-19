# Mida cTrader
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
