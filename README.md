# Mida cTrader
[![Image](https://img.shields.io/npm/v/@reiryoku/mida-ctrader)](https://www.npmjs.com/package/@reiryoku/mida-ctrader)
[![Image](https://img.shields.io/npm/l/@reiryoku/mida-ctrader)](LICENSE)
[![Image](https://img.shields.io/discord/780532638846287904?label=community)](https://discord.gg/cKyWTUsr3q)
<br>

A [Mida](https://github.com/Reiryoku-Technologies/Mida) plugin for using cTrader accounts.

## Usage
For the complete documentation refer to [Mida](https://github.com/Reiryoku-Technologies/Mida).

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

### Timeframes
The supported timeframes<br><br>
`M1` `M2` `M3` `M4` `M5` `M10` `M15` `M30`<br>
`H1` `H4` `H12`<br>
`D1`<br>
`W1`<br>
`MN1`<br>
