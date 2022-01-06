import { MidaBrokerPositionParameters } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

export type CTraderBrokerPositionParameters = MidaBrokerPositionParameters & {
    connection: CTraderConnection;
};
