import { MidaBrokerAccount } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    // @ts-ignore
    readonly #connection: CTraderConnection;
}
