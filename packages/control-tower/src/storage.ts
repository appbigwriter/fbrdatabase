import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageGatewayConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
}

export interface StorageObject {
  name: string;
  id: string;
  updatedAt: string;
  createdAt: string;
  lastAccessedAt: string;
  metadata: {
    size: number;
    mimetype: string;
    cacheControl?: string;
  };
}

export class StorageGateway {
  private readonly client: S3Client;

  constructor(private readonly config: StorageGatewayConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: config.forcePathStyle ?? true
    });
  }

  resolveBucketName(projectSlug: string, bucketName: string): string {
    const slugPart = projectSlug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const bucketPart = bucketName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    return `fbr-${slugPart}-${bucketPart}`.slice(0, 63);
  }

  async bucketExists(projectSlug: string, bucketName: string): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.resolveBucketName(projectSlug, bucketName) }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound")) {
        return false;
      }
      throw error;
    }
  }

  async ensureBucket(projectSlug: string, bucketName: string, isPublic: boolean): Promise<void> {
    const bucket = this.resolveBucketName(projectSlug, bucketName);
    const exists = await this.bucketExists(projectSlug, bucketName);
    if (!exists) {
      await this.client.send(
        new PutObjectCommand({ Bucket: bucket, Key: ".bucket-init", Body: "", ContentType: "text/plain" })
      );
    }
    if (isPublic) {
      await this.applyPublicPolicy(bucket);
    }
  }

  async listObjects(
    projectSlug: string,
    bucketName: string,
    options: { prefix?: string; limit?: number; offset?: number } = {}
  ): Promise<StorageObject[]> {
    const bucket = this.resolveBucketName(projectSlug, bucketName);
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const prefix = options.prefix ?? "";
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: limit + (options.offset ?? 0),
        Delimiter: "/"
      })
    );

    const folderEntries: StorageObject[] = (response.CommonPrefixes ?? []).map((entry) => {
      const name = String(entry.Prefix ?? "").replace(/\/$/, "");
      return {
        name,
        id: name,
        updatedAt: new Date(0).toISOString(),
        createdAt: new Date(0).toISOString(),
        lastAccessedAt: new Date(0).toISOString(),
        metadata: { size: 0, mimetype: "" }
      };
    });

    const objectEntries: StorageObject[] = (response.Contents ?? [])
      .filter((entry) => entry.Key !== ".bucket-init")
      .map((entry) => ({
        name: String(entry.Key ?? "").slice(prefix.length),
        id: String(entry.ETag ?? entry.Key ?? "").replace(/"/g, ""),
        updatedAt: entry.LastModified?.toISOString() ?? new Date().toISOString(),
        createdAt: entry.LastModified?.toISOString() ?? new Date().toISOString(),
        lastAccessedAt: entry.LastModified?.toISOString() ?? new Date().toISOString(),
        metadata: {
          size: Number(entry.Size ?? 0),
          mimetype: ""
        }
      }));

    const combined = [...folderEntries, ...objectEntries];
    const offset = options.offset ?? 0;
    return combined.slice(offset, offset + limit);
  }

  async removeObjects(projectSlug: string, bucketName: string, keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    const bucket = this.resolveBucketName(projectSlug, bucketName);
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((key) => ({ Key: sanitizeKey(key) })) }
      })
    );
  }

  async createSignedUrl(
    projectSlug: string,
    bucketName: string,
    key: string,
    expiresIn: number
  ): Promise<string> {
    const bucket = this.resolveBucketName(projectSlug, bucketName);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: bucket, Key: sanitizeKey(key) }),
      { expiresIn }
    );
  }

  private async applyPublicPolicy(bucket: string): Promise<void> {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${bucket}/*`]
        }
      ]
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) })
      );
    } catch {
      // MinIO may reject duplicate policy application; safe to ignore.
    }
  }
}

function sanitizeKey(key: string): string {
  return String(key ?? "").replace(/\.\./g, "").replace(/^\/+/, "");
}
