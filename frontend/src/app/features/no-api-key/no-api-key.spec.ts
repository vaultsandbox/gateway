import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NoApiKey } from './no-api-key';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsToast } from '../../shared/services/vs-toast';
import { environment } from '../../../environments/environment';

describe('NoApiKey', () => {
  let component: NoApiKey;
  let fixture: ComponentFixture<NoApiKey>;
  let httpMock: HttpTestingController;
  let vaultSandboxSpy: jasmine.SpyObj<VaultSandbox>;
  let vsToastSpy: jasmine.SpyObj<VsToast>;

  beforeEach(async () => {
    const vaultSandboxMock = jasmine.createSpyObj('VaultSandbox', ['setApiKey']);
    const vsToastMock = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError']);

    await TestBed.configureTestingModule({
      imports: [NoApiKey, HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: VaultSandbox, useValue: vaultSandboxMock },
        { provide: VsToast, useValue: vsToastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NoApiKey);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    vaultSandboxSpy = TestBed.inject(VaultSandbox) as jasmine.SpyObj<VaultSandbox>;
    vsToastSpy = TestBed.inject(VsToast) as jasmine.SpyObj<VsToast>;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with empty API key input and loading false', () => {
    expect(component['apiKeyInput']()).toBe('');
    expect(component['loading']()).toBe(false);
  });

  describe('saveApiKey', () => {
    it('should not make API call if key is empty', async () => {
      component['apiKeyInput'].set('');
      await component['saveApiKey']();
      httpMock.expectNone(`${environment.apiUrl}/check-key`);
    });

    it('should not make API call if key is only whitespace', async () => {
      component['apiKeyInput'].set('   ');
      await component['saveApiKey']();
      httpMock.expectNone(`${environment.apiUrl}/check-key`);
    });

    it('should validate API key and save it on success', async () => {
      const testKey = 'test-api-key-123';
      component['apiKeyInput'].set(testKey);

      const savePromise = component['saveApiKey']();

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('X-API-Key')).toBe(testKey);

      req.flush({});

      await savePromise;

      expect(vaultSandboxSpy.setApiKey).toHaveBeenCalledWith(testKey);
      expect(vsToastSpy.showSuccess).toHaveBeenCalledWith('Success', 'API key validated successfully', 3000);
    });

    it('should trim whitespace before validating', async () => {
      const testKey = '  test-api-key-123  ';
      const trimmedKey = 'test-api-key-123';
      component['apiKeyInput'].set(testKey);

      const savePromise = component['saveApiKey']();

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      expect(req.request.headers.get('X-API-Key')).toBe(trimmedKey);

      req.flush({});
      await savePromise;
    });

    it('should set loading to true during validation and false after', async () => {
      component['apiKeyInput'].set('test-key');

      const savePromise = component['saveApiKey']();
      expect(component['loading']()).toBe(true);

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      req.flush({});

      await savePromise;
      expect(component['loading']()).toBe(false);
    });

    it('should show error toast on 401 unauthorized', async () => {
      component['apiKeyInput'].set('invalid-key');

      const savePromise = component['saveApiKey']();

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      await savePromise;

      expect(vaultSandboxSpy.setApiKey).not.toHaveBeenCalled();
      expect(vsToastSpy.showError).toHaveBeenCalledWith('Error', 'Invalid API key: Unauthorized', 3000);
      expect(component['loading']()).toBe(false);
    });

    it('should show generic error toast on other errors', async () => {
      component['apiKeyInput'].set('test-key');

      const savePromise = component['saveApiKey']();

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });

      await savePromise;

      expect(vaultSandboxSpy.setApiKey).not.toHaveBeenCalled();
      expect(vsToastSpy.showError).toHaveBeenCalledWith('Error', 'Error validating API key', 3000);
      expect(component['loading']()).toBe(false);
    });

    it('should set loading to false even if error occurs', async () => {
      component['apiKeyInput'].set('test-key');

      const savePromise = component['saveApiKey']();
      expect(component['loading']()).toBe(true);

      const req = httpMock.expectOne(`${environment.apiUrl}/check-key`);
      req.error(new ProgressEvent('error'));

      await savePromise;
      expect(component['loading']()).toBe(false);
    });
  });
});
