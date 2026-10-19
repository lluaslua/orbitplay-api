-- O "Finalizar" do Novo jogo passou a publicar o jogo (DRAFT -> ACTIVE).
-- Os jogos já finalizados que ficaram no rascunho entram no catálogo do jogador.
UPDATE "Game" SET "status" = 'ACTIVE' WHERE "status" = 'DRAFT' AND "setupCompletedAt" IS NOT NULL;
