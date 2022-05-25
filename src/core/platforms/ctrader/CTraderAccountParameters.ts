import { MidaTradingAccountParameters, } from "@reiryoku/mida";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";

export type CTraderAccountParameters = MidaTradingAccountParameters & {
    connection: CTraderConnection;
    brokerAccountId: string;
    brokerName: string;
};
