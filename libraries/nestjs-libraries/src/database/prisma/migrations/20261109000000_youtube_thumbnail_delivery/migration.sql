ALTER TABLE "Post"
  ADD COLUMN "youtubeUploadKey" TEXT,
  ADD COLUMN "youtubeUploadState" TEXT,
  ADD COLUMN "youtubeVideoId" TEXT,
  ADD COLUMN "youtubeThumbnailPath" TEXT,
  ADD COLUMN "youtubeThumbnailStatus" TEXT,
  ADD COLUMN "youtubeThumbnailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "youtubeThumbnailError" TEXT,
  ADD COLUMN "youtubeThumbnailNextAt" TIMESTAMP(3);
