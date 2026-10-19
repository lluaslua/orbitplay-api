-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "columns" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "removedFromStudioAt" TIMESTAMP(3),
ADD COLUMN     "teamPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
