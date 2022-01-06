import {
    GenericObject,
    MidaBrokerOrder,
    MidaBrokerOrderRejectionType,
    MidaBrokerOrderStatus,
    MidaDate,
} from "@reiryoku/mida";
import { CTraderBrokerOrderParameters } from "#brokers/ctrader/orders/CTraderBrokerOrderParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerOrder extends MidaBrokerOrder {
    readonly #uuid: string;
    readonly #connection: CTraderConnection;

    public constructor ({
        id,
        brokerAccount,
        symbol,
        requestedVolume,
        direction,
        purpose,
        limitPrice,
        stopPrice,
        status,
        creationDate,
        lastUpdateDate,
        timeInForce,
        deals,
        position,
        rejectionType,
        isStopOut,
        uuid,
        connection,
    }: CTraderBrokerOrderParameters) {
        super({
            id,
            brokerAccount,
            symbol,
            requestedVolume,
            direction,
            purpose,
            limitPrice,
            stopPrice,
            status,
            creationDate,
            lastUpdateDate,
            timeInForce,
            deals,
            position,
            rejectionType,
            isStopOut,
        });

        this.#uuid = uuid;
        this.#connection = connection;

        // Listen events only if the order is not in a final state
        if (
            status !== MidaBrokerOrderStatus.CANCELLED &&
            status !== MidaBrokerOrderStatus.REJECTED &&
            status !== MidaBrokerOrderStatus.EXPIRED &&
            status !== MidaBrokerOrderStatus.FILLED
        ) {
            this.#configureListeners();
        }
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async cancel (): Promise<void> {
        if (this.status !== MidaBrokerOrderStatus.PENDING) {
            return;
        }

        await this.#connection.sendCommand("ProtoOACancelOrderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            orderId: this.id,
        });
    }

    // eslint-disable-next-line max-lines-per-function
    #onUpdate (descriptor: GenericObject): void {
        const order: GenericObject = descriptor.order;
        const orderId: string = order.orderId;
        const orderCreationTimestamp: number = Number(order.tradeData.openTimestamp);
        const positionId: string = order.positionId;

        if (!this.id && orderId) {
            this.id = orderId;
        }

        if (!this.creationDate && Number.isFinite(orderCreationTimestamp)) {
            this.creationDate = new MidaDate({ timestamp: orderCreationTimestamp, });
        }

        const lastUpdateTimestamp: number = Number(order.utcLastUpdateTimestamp);

        if (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateTimestamp) {
            this.lastUpdateDate = new MidaDate({ timestamp: lastUpdateTimestamp, });
        }

        switch (descriptor.executionType) {
            case "ORDER_ACCEPTED": {
                this.onStatusChange(MidaBrokerOrderStatus.ACCEPTED);

                break;
            }
            case "ORDER_FILLED": {
                if (!this.position && positionId) {

                }

                (async (): Promise<void> => {
                    this.onDeal(await this.#cTraderBrokerAccount.normalizePlainDeal(descriptor.deal));
                    this.onStatusChange(MidaBrokerOrderStatus.FILLED);
                })();

                break;
            }
            case "ORDER_CANCELLED": {
                this.onStatusChange(MidaBrokerOrderStatus.CANCELLED);

                break;
            }
            case "ORDER_EXPIRED": {
                this.onStatusChange(MidaBrokerOrderStatus.EXPIRED);

                break;
            }
            case "ORDER_REJECTED": {
                this.onStatusChange(MidaBrokerOrderStatus.REJECTED);

                break;
            }
            case "ORDER_PARTIAL_FILL": {
                (async (): Promise<void> => {
                    this.onDeal(await this.#cTraderBrokerAccount.normalizePlainDeal(descriptor.deal));
                    this.onStatusChange(MidaBrokerOrderStatus.PARTIALLY_FILLED);
                })();

                break;
            }
        }
    }

    // eslint-disable-next-line max-lines-per-function
    #configureListeners (): void {
        // <execution>
        this.#connection.on("ProtoOAExecutionEvent", (descriptor: GenericObject): void => {
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId &&
                (orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                this.#onUpdate(descriptor);
            }
        });
        // </execution>

        // <error>
        this.#connection.on("ProtoOAOrderErrorEvent", (descriptor: GenericObject): void => {
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId ||
                !(orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                return;
            }

            this.lastUpdateDate = new MidaDate();

            switch (descriptor.errorCode) {
                case "MARKET_CLOSED":
                case "SYMBOL_HAS_HOLIDAY": {
                    this.rejectionType = MidaBrokerOrderRejectionType.MARKET_CLOSED;

                    break;
                }
                case "SYMBOL_NOT_FOUND":
                case "UNKNOWN_SYMBOL": {
                    this.rejectionType = MidaBrokerOrderRejectionType.SYMBOL_NOT_FOUND;

                    break;
                }
                case "TRADING_DISABLED": {
                    this.rejectionType = MidaBrokerOrderRejectionType.SYMBOL_DISABLED;

                    break;
                }
                case "NOT_ENOUGH_MONEY": {
                    this.rejectionType = MidaBrokerOrderRejectionType.NOT_ENOUGH_MONEY;

                    break;
                }
                case "TRADING_BAD_VOLUME": {
                    this.rejectionType = MidaBrokerOrderRejectionType.INVALID_VOLUME;

                    break;
                }
                default: {
                    throw new Error();
                }
            }

            this.onStatusChange(MidaBrokerOrderStatus.REJECTED);
        });
        // </error>
    }
}
