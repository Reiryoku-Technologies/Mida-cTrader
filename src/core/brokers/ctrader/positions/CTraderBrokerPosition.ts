import {
    GenericObject,
    MidaBrokerOrder,
    MidaBrokerPosition,
    MidaBrokerPositionProtection,
    MidaBrokerPositionStatus,
} from "@reiryoku/mida";
import { CTraderBrokerPositionParameters } from "#brokers/ctrader/positions/CTraderBrokerPositionParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerPosition extends MidaBrokerPosition {
    readonly #connection: CTraderConnection;
    readonly #dispatchedOrders: Map<string, boolean>;

    public constructor ({
        id,
        orders,
        protection,
        connection,
    }: CTraderBrokerPositionParameters) {
        super({
            id,
            orders,
            protection,
        });

        this.#connection = connection;
        this.#dispatchedOrders = new Map();

        // Listen events only if the position is not in a final state
        if (status !== MidaBrokerPositionStatus.CLOSED) {
            this.#configureListeners();
        }
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        return 1;
    }

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        return 1;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        return 1;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        return 1;
    }

    public override async modifyProtection (protection: MidaBrokerPositionProtection): Promise<void> {
        await this.#connection.sendCommand("ProtoOAAmendPositionSLTPReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            positionId: this.id,
            stopLoss: protection.stopLoss,
            takeProfit: protection.takeProfit,
            trailingStopLoss: protection.trailingStopLoss,
        });
    }

    public override async setStopLoss (stopLoss: number): Promise<void> {
        await this.modifyProtection({ stopLoss, });
    }

    public override async setTakeProfit (takeProfit: number): Promise<void> {
        await this.modifyProtection({ takeProfit, });
    }

    public override async setTrailingStopLoss (trailingStopLoss:boolean): Promise<void> {
        await this.modifyProtection({ trailingStopLoss, });
    }

    #onUpdate (descriptor: GenericObject): void {
        switch (descriptor.executionType) {
            case "SWAP": {
                this.onSwap(0);

                break;
            }

            case "ORDER_ACCEPTED":
            case "ORDER_FILLED":
            case "ORDER_CANCELLED":
            case "ORDER_EXPIRED":
            case "ORDER_REJECTED":
            case "ORDER_PARTIAL_FILL": {
                const plainOrder: GenericObject = descriptor.order;
                const orderId: string = plainOrder?.orderId?.toString();
                const positionId: string = plainOrder?.positionId?.toString();

                if (
                    positionId === this.id && orderId &&
                    !this.#dispatchedOrders.has(orderId) && !this.orders.find((order: MidaBrokerOrder) => order.id === orderId)
                ) {
                    this.#dispatchedOrders.set(orderId, true);
                    this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder).then((order: MidaBrokerOrder): void => this.onOrder(order));
                }

                break;
            }
        }
    }

    #configureListeners (): void {
        this.#connection.on("ProtoOAExecutionEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onUpdate(descriptor);
            }
        });
    }
}
