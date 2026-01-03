import type { S3Client } from "bun";

export interface StorageConfig {
  s3Client: S3Client;
  endpoint?: string;
}

export interface UploadOptions {
  key: string;
  data: Buffer | Uint8Array | string;
  contentType: string;
}

export interface DownloadOptions {
  key: string;
}

export interface DeleteOptions {
  key: string;
}

export interface SignedUrlOptions {
  key: string;
  expiresIn?: number;
}

export function createStorageClient(config: StorageConfig) {
  const { s3Client, endpoint } = config;

  async function upload({
    key,
    data,
    contentType,
  }: UploadOptions): Promise<{ key: string }> {
    await s3Client.write(key, data, { type: contentType });
    return { key };
  }

  async function download({ key }: DownloadOptions): Promise<Blob> {
    const arrayBuffer = await s3Client.file(key).arrayBuffer();
    return new Blob([arrayBuffer]);
  }

  async function deleteFile({ key }: DeleteOptions): Promise<void> {
    await s3Client.delete(key);
  }

  function getSignedUrl({ key, expiresIn = 3600 }: SignedUrlOptions): string {
    return s3Client.presign(key, {
      expiresIn,
      ...(endpoint && { endpoint }),
    });
  }

  function getUploadUrl({
    key,
    expiresIn = 3600,
    contentType,
  }: SignedUrlOptions & { contentType: string }): string {
    return s3Client.presign(key, {
      method: "PUT",
      expiresIn,
      type: contentType,
      ...(endpoint && { endpoint }),
    });
  }

  async function exists(key: string): Promise<boolean> {
    return s3Client.file(key).exists();
  }

  return {
    upload,
    download,
    delete: deleteFile,
    getSignedUrl,
    getUploadUrl,
    exists,
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
