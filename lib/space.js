import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const spacesClient = new S3Client({
  region: process.env.DO_SPACES_REGION,
  endpoint: process.env.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});

export async function uploadToSpaces(buffer, fileName, mimeType, folder = "vouchers") {
  const key = `eastland/${folder}/${Date.now()}-${fileName}`;

  await spacesClient.send(
    new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: "public-read",
    })
  );

  return `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com/${key}`;
}