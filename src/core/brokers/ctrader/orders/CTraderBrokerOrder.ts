import { GenericObject, MidaBrokerOrder, MidaBrokerOrderStatus } from "@reiryoku/mida";
import { CTraderBrokerOrderParameters } from "#brokers/ctrader/orders/CTraderBrokerOrderParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerOrder extends MidaBrokerOrder {
    readonly #uuid: string;
    readonly #connection: CTraderConnection;

    public constructor ({
        id,
        brokerAccount,
        directives,
        status,
        requestDate,
        rejectionDate,
        expirationDate,
        lastUpdateDate,
        deals,
        timeInForce,
        isStopOut,
        uuid,
        connection,
    }: CTraderBrokerOrderParameters) {
        super({
            id,
            brokerAccount,
            directives,
            status,
            requestDate,
            rejectionDate,
            expirationDate,
            lastUpdateDate,
            deals,
            timeInForce,
            isStopOut,
        });

        this.#uuid = uuid;
        this.#connection = connection;

        if (status !== MidaBrokerOrderStatus.FILLED) {
            this.#configureListeners();
        }
    }

    public get cTraderBrokerAccountId (): string {
        const brokerAccount: CTraderBrokerAccount = this.brokerAccount as CTraderBrokerAccount;

        return brokerAccount.cTraderBrokerAccountId;
    }

    #onUpdate (descriptor: GenericObject): void {
        switch (Number(descriptor.executionType)) {
            case 2: {
                this.onStatusChange(MidaBrokerOrderStatus.ACCEPTED);

                break;
            }
            case 3: {
                this.onStatusChange(MidaBrokerOrderStatus.FILLED);

                break;
            }
            case 5: {
                this.onStatusChange(MidaBrokerOrderStatus.CANCELLED);

                break;
            }
            case 6: {
                this.onStatusChange(MidaBrokerOrderStatus.EXPIRED);

                break;
            }
            case 7: {
                this.onStatusChange(MidaBrokerOrderStatus.REJECTED);

                break;
            }
            case 11: {
                this.onStatusChange(MidaBrokerOrderStatus.PARTIALLY_FILLED);

                break;
            }
        }
    }

    #configureListeners (): void {
        // <execution>
        this.#connection.on("ProtoOAExecutionEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.cTraderBrokerAccountId && descriptor?.order?.tradeData?.label === this.#uuid) {
                this.#onUpdate(descriptor);
            }
        });
        // </execution>
    }
}
