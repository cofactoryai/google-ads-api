import * as fs from 'fs';
import { grpc } from "google-gax";
import { UserRefreshClient, JWT } from "google-auth-library";
import { ClientOptions } from "./client";
import {
  AllServices,
  errors,
  GoogleAdsServiceClient,
  ServiceName,
  services,
} from "./protos";
import {
  CustomerOptions,
  CustomerCredentials,
  RequestOptions,
  MutateOperation,
  MutateOptions,
} from "./types";
import { getFieldMask, toSnakeCase } from "./utils";
import { googleAdsVersion } from "./version";
import { Hooks } from "./hooks";
import TTLCache from "@isaacs/ttlcache";

// Make sure to update this version number when upgrading
export const FAILURE_KEY = `google.ads.googleads.${googleAdsVersion}.errors.googleadsfailure-bin`;

export interface CallHeaders {
  "developer-token": string;
  "login-customer-id"?: string;
  "linked-customer-id"?: string;
}

// A global service cache to avoid re-initialising services
const serviceCache = new TTLCache<ServiceName, GoogleAdsServiceClient>({
  max: 1000,
  ttl: 10 * 60 * 1000, // 10 minutes
  dispose: (service: GoogleAdsServiceClient) => {
    service.close();
  },
});

export class Service {
  protected readonly clientOptions: ClientOptions;
  protected readonly customerOptions: CustomerOptions;
  protected readonly hooks: Hooks;

  constructor(
    clientOptions: ClientOptions,
    customerOptions: CustomerOptions,
    hooks?: Hooks
  ) {
    this.clientOptions = clientOptions;
    this.customerOptions = customerOptions;
    this.hooks = hooks ?? {};

    // @ts-expect-error All fields don't need to be set here
    this.serviceCache = {};
  }

  public get credentials(): CustomerCredentials {
    return {
      customer_id: this.customerOptions.customer_id,
      login_customer_id: this.customerOptions.login_customer_id,
      linked_customer_id: this.customerOptions.linked_customer_id,
    };
  }

  protected get callHeaders(): CallHeaders {
    const headers: CallHeaders = {
      "developer-token": this.clientOptions.developer_token,
    };
    if (this.customerOptions.login_customer_id) {
      headers["login-customer-id"] = this.customerOptions.login_customer_id;
    }
    if (this.customerOptions.linked_customer_id) {
      headers["linked-customer-id"] = this.customerOptions.linked_customer_id;
    }
    return headers;
  }

  private getCredentials(): grpc.ChannelCredentials {
    let authClient;
    const sslCreds = grpc.credentials.createSsl();

    if (this.clientOptions.service_account_key_file) {
      const keyFileContent = fs.readFileSync(this.clientOptions.service_account_key_file, 'utf8');
      const keyFile = JSON.parse(keyFileContent);
      authClient = new JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: ['https://www.googleapis.com/auth/adwords'],
      });
    } else {
      authClient = new UserRefreshClient(
        this.clientOptions.client_id,
        this.clientOptions.client_secret,
        this.customerOptions.refresh_token
      );
    }

    const credentials = grpc.credentials.combineChannelCredentials(sslCreds, grpc.credentials.createFromGoogleCredential(authClient));
    return credentials;
  }

  protected loadService<T = AllServices>(service: ServiceName): T {
    const serviceCacheKey: ServiceName = service; // Corrected type for serviceCacheKey

    if (serviceCache.has(serviceCacheKey)) {
      return serviceCache.get(serviceCacheKey) as unknown as T;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { [service]: protoService } = require("google-ads-node");
    if (typeof protoService === "undefined") {
      throw new Error(`Service "${service}" could not be found`);
    }

    // Initialising services can take a few ms, so we cache when possible.
    const client = new protoService({
      sslCreds: this.getCredentials(),
    });

    serviceCache.set(serviceCacheKey, client);
    return client as unknown as T;
  }

  protected getGoogleAdsError(error: Error): errors.GoogleAdsFailure | Error {
    // @ts-expect-error No type exists for GA query error
    if (typeof error?.metadata?.internalRepr.get(FAILURE_KEY) === "undefined") {
      return error;
    }
    // @ts-expect-error No type exists for GA query error
    const [buffer] = error.metadata.internalRepr.get(FAILURE_KEY);
    return this.decodeGoogleAdsFailureBuffer(buffer);
  }

  private decodeGoogleAdsFailureBuffer(
    buffer: Buffer
  ): errors.GoogleAdsFailure {
    const googleAdsFailure = errors.GoogleAdsFailure.decode(buffer);
    return googleAdsFailure;
  }

  public decodePartialFailureError<T>(response: T & { partial_failure_error?: { details?: Array<{ type_url: string; value: Buffer }> } }): T {
    let mutate_operation_responses: errors.GoogleAdsFailure[] = [];

    const buffer = response.partial_failure_error?.details?.find((d) => d.type_url.includes("errors.GoogleAdsFailure"))?.value;
    if (buffer) {
      const decodedError = this.decodeGoogleAdsFailureBuffer(buffer);
      if (decodedError.errors && decodedError.errors.length > 0) {
        mutate_operation_responses = [decodedError];
      }
    }

    // Return an object with only the mutate_operation_responses array
    return { mutate_operation_responses } as T;
  }

  protected buildSearchRequestAndService(
    gaql: string,
    options?: RequestOptions
  ): {
    service: GoogleAdsServiceClient;
    request: services.SearchGoogleAdsRequest;
  } {
    const service: GoogleAdsServiceClient = this.loadService("GoogleAdsServiceClient");
    const request: services.SearchGoogleAdsRequest = new services.SearchGoogleAdsRequest({
      customer_id: this.customerOptions.customer_id,
      query: gaql,
      ...options,
    });
    return { service, request };
  }

  protected buildSearchStreamRequestAndService(
    gaql: string,
    options?: RequestOptions
  ): {
    service: GoogleAdsServiceClient;
    request: services.SearchGoogleAdsStreamRequest;
  } {
    const service: GoogleAdsServiceClient = this.loadService("GoogleAdsServiceClient");
    const request: services.SearchGoogleAdsStreamRequest = new services.SearchGoogleAdsStreamRequest({
      customer_id: this.customerOptions.customer_id,
      query: gaql,
      ...options,
    });
    return { service, request };
  }

  protected buildMutationRequestAndService<T extends Record<string, unknown>>(
    mutations: MutateOperation<T>[],
    options?: MutateOptions
  ): {
    service: GoogleAdsServiceClient;
    request: services.MutateGoogleAdsRequest;
  } {
    const service: GoogleAdsServiceClient = this.loadService("GoogleAdsServiceClient");
    const mutateOperations = mutations.map((mutation): services.MutateOperation => {
      const operation: MutateOperation<T> = {
        operation: mutation.operation ?? "create",
        resource: mutation.resource,
        entity: mutation.entity,
        exempt_policy_violation_keys: mutation.exempt_policy_violation_keys,
        update_mask: mutation.operation === "update" ? getFieldMask(mutation.resource) : undefined,
        // Spread any additional properties from T that are not toJSON
        ...(mutation.resource as Omit<T, 'toJSON'>),
      };
      const mutateOperation = new services.MutateOperation({
        [toSnakeCase(`${mutation.entity}Operation`)]: operation,
      });
      return mutateOperation;
    });
    const request = new services.MutateGoogleAdsRequest({
      customer_id: this.customerOptions.customer_id,
      mutate_operations: mutateOperations,
      ...options,
    });
    return { service, request };
  }

  protected buildOperations<Op, Ent>(
    type: "create" | "update" | "remove",
    entities: Ent[],
    message?: Ent
  ): Op[] {
    const ops = entities.map((e) => {
      const op = {
        [type]: e,
        operation: type,
      };
      //@ts-ignore
      if (type === "create" && e?.exempt_policy_violation_keys?.length) {
        // @ts-expect-error Field required for policy violation exemptions
        op.exempt_policy_violation_keys = e.exempt_policy_violation_keys;
        //@ts-ignore
        delete e.exempt_policy_violation_keys;
      } else if (type === "update") {
        // @ts-expect-error Field required for updates
        op.update_mask = getFieldMask(
          // @ts-expect-error Message types have a toObject method
          message.toObject(e, {
            defaults: false,
          })
        );
      }
      return op;
    });
    return ops as unknown as Op[];
  }

  protected buildRequest<Op, Req, Options>(
    operations: Op[],
    options?: Options
  ): Req {
    const request = {
      customer_id: this.customerOptions.customer_id,
      operations,
      ...options,
    };
    return request as unknown as Req;
  }
}
