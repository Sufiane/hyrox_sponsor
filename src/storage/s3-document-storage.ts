import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DocumentKey } from '../common/document-key';
import type { EnvironmentVariables } from '../config/env.validation';
import { DocumentStorage } from './document-storage';

@Injectable()
export class S3DocumentStorage extends DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();

    const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });

    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.client = new S3Client({
      region: config.get('STORAGE_REGION', { infer: true }),
      endpoint,
      forcePathStyle: endpoint != null,
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  async put(key: DocumentKey, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: 'attachment',
      }),
    );
  }

  async delete(key: DocumentKey): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedGetUrl(key: DocumentKey, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
