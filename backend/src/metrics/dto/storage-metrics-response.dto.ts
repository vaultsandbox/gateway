import { ApiProperty } from '@nestjs/swagger';

export class StorageStatsDto {
  @ApiProperty({ description: 'Maximum configured memory in bytes', example: 524288000 })
  maxMemoryBytes: number;

  @ApiProperty({ description: 'Maximum configured memory in megabytes (stringified)', example: '500.00' })
  maxMemoryMB: string;

  @ApiProperty({ description: 'Currently used memory in bytes', example: 157286400 })
  usedMemoryBytes: number;

  @ApiProperty({ description: 'Currently used memory in megabytes (stringified)', example: '150.00' })
  usedMemoryMB: string;

  @ApiProperty({ description: 'Available memory in bytes', example: 367001600 })
  availableMemoryBytes: number;

  @ApiProperty({ description: 'Available memory in megabytes (stringified)', example: '350.00' })
  availableMemoryMB: string;

  @ApiProperty({ description: 'Memory utilization percentage (stringified)', example: '30.00' })
  utilizationPercent: string;
}

export class EmailStatsDto {
  @ApiProperty({ description: 'Total emails currently stored (non-evicted)', example: 1250 })
  totalStored: number;

  @ApiProperty({ description: 'Total emails evicted to free memory', example: 450 })
  totalEvicted: number;

  @ApiProperty({ description: 'Number of tombstoned entries awaiting compaction', example: 85 })
  tombstones: number;

  @ApiProperty({ description: 'Age in ms of the oldest stored email', example: 3600000, nullable: true })
  oldestEmailAge: number | null;

  @ApiProperty({ description: 'Age in ms of the newest stored email', example: 1500, nullable: true })
  newestEmailAge: number | null;
}

export class EvictionStatsDto {
  @ApiProperty({ description: 'Maximum age in seconds before time-based eviction', example: 3600, nullable: true })
  maxAgeSeconds: number | null;

  @ApiProperty({ description: 'Whether time-based eviction is enabled', example: false })
  maxAgeEnabled: boolean;
}

export class StorageMetricsResponseDto {
  @ApiProperty({ description: 'Memory usage statistics', type: StorageStatsDto })
  storage: StorageStatsDto;

  @ApiProperty({ description: 'Email storage counters', type: EmailStatsDto })
  emails: EmailStatsDto;

  @ApiProperty({ description: 'Eviction configuration and status', type: EvictionStatsDto })
  eviction: EvictionStatsDto;
}
