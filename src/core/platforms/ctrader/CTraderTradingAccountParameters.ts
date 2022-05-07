import { MidaTradingAccountParameters } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

export type CTraderTradingAccountParameters = MidaTradingAccountParameters & {
    connection: CTraderConnection;
    brokerAccountId: string;
    brokerName: string;
};
