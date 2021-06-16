import { CTraderConnection } from "@reiryoku/ctrader-layer";

export class CTrader {
    static readonly #demoConnection: CTraderConnection = new CTraderConnection({
        host: "demo.ctraderapi.com",
        port: 5035,
    });
    static readonly #liveConnection: CTraderConnection = new CTraderConnection({
        host: "live.ctraderapi.com",
        port: 5035,
    });

    static async #openConnections (): Promise<void> {
        await Promise.all([ CTrader.#demoConnection.open(), CTrader.#liveConnection.open(), ]);
    }
}
