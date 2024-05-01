import { Customer } from "./customer";
import { CustomerOptions } from "./types";
import { Hooks } from "./hooks";
import { services } from "./protos";
import { Service } from "./service";
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

export interface ClientOptions {
  client_id: string;
  client_secret: string;
  developer_token: string;
  disable_parsing?: boolean;
  service_account_key?: string;
  login_customer_id?: string; // Added login_customer_id to ClientOptions
}

// Define an interface for the structure of a Google service account JSON file
interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export class Client {
  private readonly options: ClientOptions;
  private accessToken: string | null = null;

  constructor(options: ClientOptions) {
    this.options = options;
    // If service account key is provided, initialize service account flow
    if (this.options.service_account_key) {
      this.initializeServiceAccountFlow();
    }
  }

  private initializeServiceAccountFlow(): void {
    if (this.options.service_account_key) {
      // Parse the service account key
      const serviceAccountKey: ServiceAccountKey = JSON.parse(this.options.service_account_key);
      // Generate JWT
      const jwtToken = this.generateJWT(serviceAccountKey);
      // Exchange JWT for an access token
      this.exchangeJWTForAccessToken(jwtToken);
    } else {
      throw new Error('Service account key is not provided');
    }
  }

  private generateJWT(serviceAccountKey: ServiceAccountKey): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600; // Token valid for one hour

    const jwtPayload = {
      iss: serviceAccountKey.client_email,
      sub: serviceAccountKey.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: iat,
      exp: exp,
      scope: 'https://www.googleapis.com/auth/adwords'
    };

    return jwt.sign(jwtPayload, serviceAccountKey.private_key, { algorithm: 'RS256' });
  }

  private async exchangeJWTForAccessToken(jwtToken: string): Promise<void> {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const tokenData = {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtToken
    };

    try {
      const response = await axios.post(tokenUrl, tokenData);
      this.accessToken = response.data.access_token;
    } catch (error) {
      console.error('Error exchanging JWT for access token:', error);
      throw error;
    }
  }

  public Customer(customerOptions: CustomerOptions, hooks?: Hooks): Customer {
    const cus = new Customer(this.options, customerOptions, hooks);
    return cus;
  }

  public async listAccessibleCustomers(
    refreshToken: string
  ): Promise<services.ListAccessibleCustomersResponse> {
    const service = new Service(this.options, {
      customer_id: "",
      refresh_token: refreshToken,
    });
    service.setAccessToken(this.accessToken); // Set the access token in the Service instance
    const customerService = await service.getServiceClient<services.CustomerService>(
      "CustomerServiceClient"
    );
    try {
      const response = await customerService.listAccessibleCustomers({});
      return response;
    } catch (err) {
      console.log(err);
      if (err instanceof Error) {
        throw service.processGoogleAdsError(err);
      } else {
        throw new Error('An unknown error occurred');
      }
    }
  }
}
