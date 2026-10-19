-- CreateTable
CREATE TABLE "release_catalog_releases" (
    "id" UUID NOT NULL,
    "app" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "notesEn" TEXT NOT NULL,
    "notesZhCn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_catalog_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "release_catalog_releases_app_version_key" ON "release_catalog_releases"("app", "version");
