-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "sex" TEXT,
    "height" REAL,
    "weight" REAL,
    "maxHR" INTEGER,
    "restingHR" INTEGER,
    "preferredUnits" TEXT NOT NULL DEFAULT 'metric',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "sport" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "distance" REAL,
    "avgHR" INTEGER,
    "maxHR" INTEGER,
    "avgPace" REAL,
    "avgSpeed" REAL,
    "elevationGain" REAL,
    "calories" INTEGER,
    "cadence" REAL,
    "averagePower" REAL,
    "normalizedPower" REAL,
    "aerobicTrainingEffect" REAL,
    "anaerobicTrainingEffect" REAL,
    "trainingLoad" REAL,
    "trainingLoadMethod" TEXT,
    "source" TEXT NOT NULL,
    "rawData" TEXT,
    "matchedManually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivitySplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "splitNumber" INTEGER NOT NULL,
    "distance" REAL,
    "duration" INTEGER,
    "pace" REAL,
    "avgHR" INTEGER,
    "elevation" REAL,
    CONSTRAINT "ActivitySplit_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "restingHR" INTEGER,
    "avgHR" INTEGER,
    "sleepDuration" INTEGER,
    "sleepScore" INTEGER,
    "stress" INTEGER,
    "bodyBattery" INTEGER,
    "steps" INTEGER,
    "weight" REAL,
    "source" TEXT NOT NULL DEFAULT 'demo',
    CONSTRAINT "DailyHealth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "goalType" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "targetDate" DATETIME NOT NULL,
    "targetDistance" REAL,
    "targetTime" INTEGER,
    "trainingWeeks" INTEGER NOT NULL,
    "sessionsPerWeek" INTEGER NOT NULL,
    "longRunDay" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isOriginal" BOOLEAN NOT NULL DEFAULT false,
    "generatorInput" TEXT,
    CONSTRAINT "TrainingPlan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "TrainingGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedWorkout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "workoutType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetDuration" INTEGER,
    "targetDistance" REAL,
    "targetPaceMin" REAL,
    "targetPaceMax" REAL,
    "targetHRMin" INTEGER,
    "targetHRMax" INTEGER,
    "structureJSON" TEXT,
    "explanation" TEXT,
    "completionStatus" TEXT NOT NULL DEFAULT 'planned',
    "linkedActivityId" TEXT,
    "adaptationReason" TEXT,
    "userModified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannedWorkout_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannedWorkout_linkedActivityId_fkey" FOREIGN KEY ("linkedActivityId") REFERENCES "Activity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingAdaptation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affectedWorkoutId" TEXT,
    "outcome" TEXT NOT NULL,
    "previousWorkout" TEXT,
    "updatedWorkout" TEXT,
    "reason" TEXT NOT NULL,
    "metricsUsed" TEXT,
    "revertedAt" DATETIME,
    CONSTRAINT "TrainingAdaptation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAdaptation_affectedWorkoutId_fkey" FOREIGN KEY ("affectedWorkoutId") REFERENCES "PlannedWorkout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolTrace" TEXT,
    "answeredBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "message" TEXT,
    "steps" TEXT,
    "activitiesImported" INTEGER NOT NULL DEFAULT 0,
    "healthRecordsImported" INTEGER NOT NULL DEFAULT 0,
    "workoutsMatched" INTEGER NOT NULL DEFAULT 0,
    "adaptationsMade" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "Activity_userId_date_idx" ON "Activity"("userId", "date");

-- CreateIndex
CREATE INDEX "Activity_sport_date_idx" ON "Activity"("sport", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_externalId_source_key" ON "Activity"("externalId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySplit_activityId_splitNumber_key" ON "ActivitySplit"("activityId", "splitNumber");

-- CreateIndex
CREATE INDEX "DailyHealth_date_idx" ON "DailyHealth"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyHealth_userId_date_key" ON "DailyHealth"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedWorkout_linkedActivityId_key" ON "PlannedWorkout"("linkedActivityId");

-- CreateIndex
CREATE INDEX "PlannedWorkout_planId_date_idx" ON "PlannedWorkout"("planId", "date");

-- CreateIndex
CREATE INDEX "TrainingAdaptation_planId_timestamp_idx" ON "TrainingAdaptation"("planId", "timestamp");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_createdAt_idx" ON "ChatMessage"("userId", "createdAt");
