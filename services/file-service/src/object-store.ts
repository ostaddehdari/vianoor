import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { ServiceError } from '@vianoor/service-runtime';
let client: S3Client | undefined;
function storage() {
  const endpoint = process.env.S3_ENDPOINT,
    bucket = process.env.S3_BUCKET,
    accessKeyId = process.env.S3_ACCESS_KEY,
    secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
    throw new ServiceError(503, 'STORAGE_UNAVAILABLE');
  client ??= new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2,
  });
  return { client, bucket };
}
export async function putObject(key: string, bytes: Buffer, mime: string) {
  const { client, bucket } = storage();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime }),
    { abortSignal: AbortSignal.timeout(30000) },
  );
}
export async function getObject(key: string) {
  const { client, bucket } = storage();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(30000),
  });
  if (!result.Body) throw new ServiceError(503, 'STORAGE_UNAVAILABLE');
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function deleteObject(key: string) {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(30000),
  });
}
export async function storageReady() {
  const { client, bucket } = storage();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    if (
      process.env.S3_CREATE_BUCKET !== '1' ||
      (error as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode !== 404
    )
      throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
