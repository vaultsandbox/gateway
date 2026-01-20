import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmailSpamAnalysisComponent } from './email-spam-analysis';
import { SpamSymbol } from '../../interfaces';

describe('EmailSpamAnalysisComponent', () => {
  let component: EmailSpamAnalysisComponent;
  let fixture: ComponentFixture<EmailSpamAnalysisComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailSpamAnalysisComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailSpamAnalysisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('getActionClass', () => {
    it('should return green classes for "no action"', () => {
      const result = component.getActionClass('no action');
      expect(result).toContain('bg-green-100');
    });

    it('should return yellow classes for "greylist"', () => {
      const result = component.getActionClass('greylist');
      expect(result).toContain('bg-yellow-100');
    });

    it('should return yellow classes for "add header"', () => {
      const result = component.getActionClass('add header');
      expect(result).toContain('bg-yellow-100');
    });

    it('should return red classes for "rewrite subject"', () => {
      const result = component.getActionClass('rewrite subject');
      expect(result).toContain('bg-red-100');
    });

    it('should return red classes for "soft reject"', () => {
      const result = component.getActionClass('soft reject');
      expect(result).toContain('bg-red-100');
    });

    it('should return red classes for "reject"', () => {
      const result = component.getActionClass('reject');
      expect(result).toContain('bg-red-100');
    });

    it('should return default classes for undefined action', () => {
      const result = component.getActionClass(undefined);
      expect(result).toContain('bg-surface-200');
    });

    it('should return default classes for unknown action', () => {
      const result = component.getActionClass('unknown');
      expect(result).toContain('bg-surface-200');
    });
  });

  describe('getScoreClass', () => {
    it('should return surface class when score is undefined', () => {
      const result = component.getScoreClass(undefined);
      expect(result).toBe('text-surface-500');
    });

    it('should return green class for negative score', () => {
      const result = component.getScoreClass(-1);
      expect(result).toContain('text-green-600');
    });

    it('should return green-500 class for score between 0 and 3', () => {
      const result = component.getScoreClass(2);
      expect(result).toContain('text-green-500');
    });

    it('should return yellow class for score between 3 and threshold', () => {
      const result = component.getScoreClass(4, 6);
      expect(result).toContain('text-yellow-600');
    });

    it('should return red-600 class for score between threshold and 10', () => {
      const result = component.getScoreClass(7, 6);
      expect(result).toContain('text-red-600');
    });

    it('should return red-700 bold class for score >= 10', () => {
      const result = component.getScoreClass(10);
      expect(result).toContain('text-red-700');
      expect(result).toContain('font-bold');
    });

    it('should use default threshold of 6.0 when requiredScore is undefined', () => {
      const result = component.getScoreClass(5);
      expect(result).toContain('text-yellow-600');
    });
  });

  describe('getVerdict', () => {
    it('should return Unknown when spamAnalysis is undefined', () => {
      component.spamAnalysis = undefined;
      const result = component.getVerdict();
      expect(result.text).toBe('Unknown');
      expect(result.class).toBe('text-surface-500');
    });

    it('should return Unknown when status is not analyzed', () => {
      component.spamAnalysis = { status: 'skipped' };
      const result = component.getVerdict();
      expect(result.text).toBe('Unknown');
    });

    it('should return Unknown when status is error', () => {
      component.spamAnalysis = { status: 'error' };
      const result = component.getVerdict();
      expect(result.text).toBe('Unknown');
    });

    it('should return Spam when isSpam is true', () => {
      component.spamAnalysis = { status: 'analyzed', isSpam: true, score: 10 };
      const result = component.getVerdict();
      expect(result.text).toBe('Spam');
      expect(result.class).toContain('text-red-600');
    });

    it('should return Clean when score is negative', () => {
      component.spamAnalysis = { status: 'analyzed', isSpam: false, score: -1 };
      const result = component.getVerdict();
      expect(result.text).toBe('Clean');
      expect(result.class).toContain('text-green-600');
    });

    it('should return Likely Clean when score is between 0 and 3', () => {
      component.spamAnalysis = { status: 'analyzed', isSpam: false, score: 2 };
      const result = component.getVerdict();
      expect(result.text).toBe('Likely Clean');
      expect(result.class).toContain('text-green-500');
    });

    it('should return Suspicious when score is >= 3', () => {
      component.spamAnalysis = { status: 'analyzed', isSpam: false, score: 4 };
      const result = component.getVerdict();
      expect(result.text).toBe('Suspicious');
      expect(result.class).toContain('text-yellow-600');
    });

    it('should use default score of 0 when score is undefined', () => {
      component.spamAnalysis = { status: 'analyzed', isSpam: false };
      const result = component.getVerdict();
      expect(result.text).toBe('Likely Clean');
    });
  });

  describe('categorizeSymbols', () => {
    it('should return empty arrays when spamAnalysis is undefined', () => {
      component.spamAnalysis = undefined;
      const result = component.categorizeSymbols();
      expect(result.positive).toEqual([]);
      expect(result.negative).toEqual([]);
      expect(result.neutral).toEqual([]);
    });

    it('should return empty arrays when symbols is undefined', () => {
      component.spamAnalysis = { status: 'analyzed' };
      const result = component.categorizeSymbols();
      expect(result.positive).toEqual([]);
      expect(result.negative).toEqual([]);
      expect(result.neutral).toEqual([]);
    });

    it('should categorize positive score symbols', () => {
      const symbols: SpamSymbol[] = [
        { name: 'SPAM_RULE', score: 5 },
        { name: 'SPAM_RULE_2', score: 3 },
      ];
      component.spamAnalysis = { status: 'analyzed', symbols };
      const result = component.categorizeSymbols();
      expect(result.positive.length).toBe(2);
      expect(result.positive[0].score).toBe(5); // sorted descending
      expect(result.positive[1].score).toBe(3);
    });

    it('should categorize negative score symbols', () => {
      const symbols: SpamSymbol[] = [
        { name: 'HAM_RULE', score: -2 },
        { name: 'HAM_RULE_2', score: -5 },
      ];
      component.spamAnalysis = { status: 'analyzed', symbols };
      const result = component.categorizeSymbols();
      expect(result.negative.length).toBe(2);
      expect(result.negative[0].score).toBe(-5); // sorted ascending (most negative first)
      expect(result.negative[1].score).toBe(-2);
    });

    it('should categorize neutral score symbols', () => {
      const symbols: SpamSymbol[] = [{ name: 'NEUTRAL_RULE', score: 0 }];
      component.spamAnalysis = { status: 'analyzed', symbols };
      const result = component.categorizeSymbols();
      expect(result.neutral.length).toBe(1);
      expect(result.neutral[0].name).toBe('NEUTRAL_RULE');
    });

    it('should categorize mixed symbols correctly', () => {
      const symbols: SpamSymbol[] = [
        { name: 'SPAM', score: 5 },
        { name: 'HAM', score: -3 },
        { name: 'NEUTRAL', score: 0 },
      ];
      component.spamAnalysis = { status: 'analyzed', symbols };
      const result = component.categorizeSymbols();
      expect(result.positive.length).toBe(1);
      expect(result.negative.length).toBe(1);
      expect(result.neutral.length).toBe(1);
    });
  });

  describe('getSymbolScoreClass', () => {
    it('should return red class for positive score', () => {
      const result = component.getSymbolScoreClass(5);
      expect(result).toContain('text-red-600');
    });

    it('should return green class for negative score', () => {
      const result = component.getSymbolScoreClass(-3);
      expect(result).toContain('text-green-600');
    });

    it('should return surface class for zero score', () => {
      const result = component.getSymbolScoreClass(0);
      expect(result).toBe('text-surface-500');
    });
  });

  describe('formatScore', () => {
    it('should format positive score with plus sign', () => {
      const result = component.formatScore(5.5);
      expect(result).toBe('+5.50');
    });

    it('should format negative score without plus sign', () => {
      const result = component.formatScore(-3.2);
      expect(result).toBe('-3.20');
    });

    it('should format zero score without plus sign', () => {
      const result = component.formatScore(0);
      expect(result).toBe('0.00');
    });
  });

  describe('formatAction', () => {
    it('should return Unknown for undefined action', () => {
      const result = component.formatAction(undefined);
      expect(result).toBe('Unknown');
    });

    it('should capitalize single word action', () => {
      const result = component.formatAction('reject');
      expect(result).toBe('Reject');
    });

    it('should capitalize multi-word action', () => {
      const result = component.formatAction('no action');
      expect(result).toBe('No Action');
    });

    it('should capitalize "add header"', () => {
      const result = component.formatAction('add header');
      expect(result).toBe('Add Header');
    });

    it('should capitalize "soft reject"', () => {
      const result = component.formatAction('soft reject');
      expect(result).toBe('Soft Reject');
    });
  });
});
