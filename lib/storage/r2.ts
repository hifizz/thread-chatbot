import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "@/constants/attachment"

// Cloudflare R2 走 S3 兼容 API。仅服务端使用（凭证不出服务器）。

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  )
}

declare global {
  var __r2Client: S3Client | undefined
}

function getClient(): S3Client {
  if (globalThis.__r2Client) return globalThis.__r2Client
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    // aws-sdk v3.729+ 默认的 flexible checksums 与 R2 不兼容（presigned 场景还会
    // SignatureDoesNotMatch），必须显式降级为 WHEN_REQUIRED。
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
  if (process.env.NODE_ENV !== "production") globalThis.__r2Client = client
  return client
}

const bucket = () => process.env.R2_BUCKET!

/** 签发浏览器直传用的 PUT 链接；ContentType 参与签名，客户端篡改即 403 */
export async function presignUpload(key: string, contentType: string) {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  )
}

/** 签发短时效读取链接（私有桶的唯一读取入口） */
export async function presignDownload(key: string) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    }
  )
}

/** 读取对象内容（服务端解析用） */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  )
  if (!res.Body) throw new Error(`R2 对象为空: ${key}`)
  return res.Body.transformToByteArray()
}

/** 返回对象实际大小（字节）；对象不存在时抛错 */
export async function headObjectSize(key: string): Promise<number> {
  const res = await getClient().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: key })
  )
  return res.ContentLength ?? 0
}

export async function deleteObject(key: string) {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key })
  )
}
