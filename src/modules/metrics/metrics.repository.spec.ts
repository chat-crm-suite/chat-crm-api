// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { MetricsRepository, SentimentType } from './metrics.repository';
import { AgentQuery } from './metrics.interface';

describe.skip('MetricsRepository', () => {
  let repository: MetricsRepository;
  let sqlMock: jest.Mock;

  const mockAgentQueryResults: AgentQuery[] = [
    {
      id: 'uuid1',
      username: 'username1',
      firstName: 'Juan',
      lastName: 'Perez',
      total: 10,
      avgNeg: 0.1,
      avgPos: 0.85,
      avgNeu: 0.05,
      profile: '',
      phone: ''
    },
    {
      id: 'uuid2',
      username: 'username2',
      firstName: 'Maria',
      lastName: 'Garcia',
      total: 8,
      avgNeg: 0.75,
      avgPos: 0.15,
      avgNeu: 0.1,
      profile: '',
      phone: ''
    }
  ];

  beforeEach(async () => {
    // Create mocks and save references
    sqlMock = jest.fn((_strings: TemplateStringsArray, ..._values: unknown[]): Promise<AgentQuery[]> => {
      return Promise.resolve(mockAgentQueryResults);
    });

    const mockDataSource = {
      sql: sqlMock
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource
        }
      ]
    }).compile();

    repository = module.get<MetricsRepository>(MetricsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAgentsFast', () => {
    it('should return agents with positive sentiment', async () => {
      // Arrange
      const label: SentimentType = 'POS';
      const limit = 5;

      sqlMock.mockResolvedValue(mockAgentQueryResults);

      // Act
      const result = await repository.getAgentsFast(label, limit);

      // Assert
      expect(result).toEqual(mockAgentQueryResults);
      expect(sqlMock).toHaveBeenCalledTimes(1);
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(Array),
        label,
        limit
      )
    });

    it('should use the default limit of 5 if not provided', async () => {
      // Arrange
      const label: SentimentType = 'NEG';
      sqlMock.mockResolvedValue(mockAgentQueryResults);

      // Act
      await repository.getAgentsFast(label);

      // Assert
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(Array),
        label,
        5
      );
    });

    it.each<{ label: SentimentType, limit: number }>([
      { label: 'POS', limit: 1 },
      { label: 'NEU', limit: 2 },
      { label: 'NEG', limit: 3 },
    ])('should work with sentiment $label', async ({ label, limit }) => {
      // Act
      void await repository.getAgentsFast(label, limit);

      // Assert
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(Array),
        label,
        limit
      )
    })

    it('should return an empty array when there are no results', async () => {
      // Arrange
      const label: SentimentType = 'POS';
      const emptyResult: AgentQuery[] = [];
      sqlMock.mockResolvedValue(emptyResult);

      // Act
      const result = await repository.getAgentsFast(label, 5);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should handle database errors', async () => {
      // Arrange
      const label: SentimentType = 'POS';
      const dbError = new Error('Database connection failed');
      sqlMock.mockRejectedValue(dbError);

      // Act & Assert
      await expect(repository.getAgentsFast(label, 5))
        .rejects
        .toThrow('Database connection failed');
    });

    it.each<number>([3, 5, 10, 20])('should respect the custom limit of %i', async (limit) => {
      // Arrange
      const label: SentimentType = 'POS';

      // Act
      void await repository.getAgentsFast(label, limit);

      // Assert
      expect(sqlMock).toHaveBeenCalledWith(
        expect.any(Array),
        label,
        limit
      )
    })
  });
});
