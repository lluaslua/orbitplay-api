-- O app abre a build e acompanha o jogo: tempo ativo somado pelo servidor e a
-- desistência que devolve a vaga (Tela 17).

-- AlterEnum
ALTER TYPE "ParticipationStatus" ADD VALUE 'ABANDONED';

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "activeSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastExitCode" INTEGER,
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "launchCount" INTEGER NOT NULL DEFAULT 0;

