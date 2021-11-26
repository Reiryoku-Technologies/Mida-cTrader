import { MidaBrokerOrderParameters } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

export type CTraderBrokerOrderParameters = MidaBrokerOrderParameters & {
    uuid: string;
    connection: CTraderConnection;
};
