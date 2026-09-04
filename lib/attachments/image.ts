"use client"

import {
  IMAGE_ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_MIME_TYPES,
  type ImageAttachmentMimeType,
} from "@/constants/attachment"

export function isImageAttachmentMimeType(
  mediaType: string
): mediaType is ImageAttachmentMimeType {
  return (IMAGE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mediaType)
}

export function imageResizeDimensions(
  width: number,
  height: number,
  maxLongestEdge = IMAGE_ATTACHMENT_LIMITS.maxLongestEdge
): { width: number; height: number } {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxLongestEdge) return { width, height }
  const scale = maxLongestEdge / longestEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function resizedImageOutput(mediaType: ImageAttachmentMimeType): {
  mediaType: ImageAttachmentMimeType
  extension: string
  quality?: number
} {
  if (mediaType === "image/png") {
    return { mediaType, extension: "png" }
  }
  return {
    mediaType: IMAGE_ATTACHMENT_LIMITS.lossyOutputMediaType,
    extension: "webp",
    quality: IMAGE_ATTACHMENT_LIMITS.lossyQuality,
  }
}

export function imageFilenameWithExtension(
  filename: string,
  extension: string
): string {
  const basename = filename.replace(/\.[^.]*$/, "") || "image"
  return `${basename}.${extension}`
}

export async function preprocessImageAttachment(file: File): Promise<File> {
  if (!isImageAttachmentMimeType(file.type)) return file
  const bitmap = await createImageBitmap(file)
  try {
    const dimensions = imageResizeDimensions(bitmap.width, bitmap.height)
    if (dimensions.width === bitmap.width && dimensions.height === bitmap.height) {
      return file
    }
    const canvas = document.createElement("canvas")
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法处理图片")
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
    const output = resizedImageOutput(file.type)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("图片压缩失败，请重试")),
        output.mediaType,
        output.quality
      )
    })
    return new File(
      [blob],
      imageFilenameWithExtension(file.name, output.extension),
      { type: output.mediaType, lastModified: file.lastModified }
    )
  } finally {
    bitmap.close()
  }
}
