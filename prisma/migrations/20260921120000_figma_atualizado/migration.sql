-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'pt-BR';

-- AlterTable
ALTER TABLE "PlayerProfile" ADD COLUMN     "tutorialSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "ageRating" TEXT,
ADD COLUMN     "developmentStage" TEXT,
ADD COLUMN     "engine" TEXT,
ADD COLUMN     "gameModes" TEXT[],
ADD COLUMN     "languages" TEXT[],
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "subGenres" TEXT[],
ADD COLUMN     "tagline" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trailerUrl" TEXT;

-- AlterTable
ALTER TABLE "Build" ADD COLUMN     "platforms" TEXT[];

-- AlterTable
ALTER TABLE "Playtest" ADD COLUMN     "eliteOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresController" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "formSeconds" INTEGER;

-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "atSecond" INTEGER;

-- CreateTable
CREATE TABLE "StudioGroup" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StudioGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "GameAccess" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginKey" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PluginKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePluginConfig" (
    "gameId" TEXT NOT NULL,
    "sdkVersion" TEXT,
    "maps" JSONB NOT NULL DEFAULT '[]',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamePluginConfig_pkey" PRIMARY KEY ("gameId")
);

-- CreateTable
CREATE TABLE "RetestInvite" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playtestId" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "RetestInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioGroup_studioId_name_key" ON "StudioGroup"("studioId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GameAccess_gameId_userId_key" ON "GameAccess"("gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAccess_gameId_groupId_key" ON "GameAccess"("gameId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginKey_codeHash_key" ON "PluginKey"("codeHash");

-- CreateIndex
CREATE INDEX "PluginKey_gameId_idx" ON "PluginKey"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "RetestInvite_playtestId_playerId_key" ON "RetestInvite"("playtestId", "playerId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudioGroup" ADD CONSTRAINT "StudioGroup_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioGroupMember" ADD CONSTRAINT "StudioGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudioGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioGroupMember" ADD CONSTRAINT "StudioGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAccess" ADD CONSTRAINT "GameAccess_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAccess" ADD CONSTRAINT "GameAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAccess" ADD CONSTRAINT "GameAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudioGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginKey" ADD CONSTRAINT "PluginKey_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePluginConfig" ADD CONSTRAINT "GamePluginConfig_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetestInvite" ADD CONSTRAINT "RetestInvite_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetestInvite" ADD CONSTRAINT "RetestInvite_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetestInvite" ADD CONSTRAINT "RetestInvite_playtestId_fkey" FOREIGN KEY ("playtestId") REFERENCES "Playtest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dados ----------------------------------------------------------------------
-- Listas novas em linhas antigas começam vazias, não nulas.
UPDATE "Game" SET "subGenres" = '{}' WHERE "subGenres" IS NULL;
UPDATE "Game" SET "gameModes" = '{}' WHERE "gameModes" IS NULL;
UPDATE "Game" SET "languages" = '{}' WHERE "languages" IS NULL;
UPDATE "Build" SET "platforms" = '{}' WHERE "platforms" IS NULL;

-- Jogo cadastrado antes do "Novo jogo" completo continua recebendo teste.
UPDATE "Game" SET "setupCompletedAt" = "createdAt" WHERE "setupCompletedAt" IS NULL;

-- Os gêneros em português viram os da lista do Figma (texto 1183:7598).
UPDATE "Game" SET "genres" = array_replace("genres", 'Ação', 'Action');
UPDATE "Game" SET "genres" = array_replace("genres", 'Aventura', 'Adventure');
UPDATE "Game" SET "genres" = array_replace("genres", 'Corrida', 'Racing');
UPDATE "Game" SET "genres" = array_replace("genres", 'Estratégia', 'Strategy');
UPDATE "Game" SET "genres" = array_replace("genres", 'Simulação', 'Simulation');
UPDATE "Game" SET "genres" = array_replace("genres", 'Esporte', 'Sports');
UPDATE "Game" SET "genres" = array_replace("genres", 'Terror', 'Horror');
