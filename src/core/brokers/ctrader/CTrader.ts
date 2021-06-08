import { GenericObject } from "@reiryoku/mida";

const { CTraderConnection, } = require("@reiryoku/ctrader-layer");

export class CTrader {
    static #demoConnection: GenericObject = new CTraderConnection({
        host: "demo.ctraderapi.com",
        port: 5035,
    });
    static #liveConnection: GenericObject = new CTraderConnection({
        host: "live.ctraderapi.com",
        port: 5035,
    });
}
