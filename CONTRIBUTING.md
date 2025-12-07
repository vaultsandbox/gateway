# Contributing to VaultSandbox Gateway

First off, thank you for considering contributing! This project and its community appreciate your time and effort.

Please take a moment to review this document in order to make the contribution process easy and effective for everyone involved.

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to hello@vaultsandbox.com.

## How You Can Contribute

There are many ways to contribute, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests or writing code which can be incorporated into the main project.

### Reporting Bugs

If you find a bug, please ensure the bug was not already reported by searching on GitHub under [Issues](https://github.com/vaultsandbox/gateway/issues). If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/vaultsandbox/gateway/issues/new). Be sure to include a **title and clear description**, as much relevant information as possible, and a **code sample** or an **executable test case** demonstrating the expected behavior that is not occurring.

### Suggesting Enhancements

If you have an idea for an enhancement, please open an issue with a clear title and description. Describe the enhancement, its potential benefits, and any implementation ideas you might have.

### Pull Requests

We love pull requests. Here's a quick guide:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix: `git checkout -b feat/my-awesome-feature` or `git checkout -b fix/that-annoying-bug`.
3.  Make your changes, adhering to the coding style.
4.  Add or update tests for your changes.
5.  Ensure all tests pass (`npm run test` and `npm run test:e2e`).
6.  Ensure your code is linted and formatted (`npm run lint` and `npm run format`).
7.  Commit your changes with a descriptive commit message.
8.  Push your branch to your fork.
9.  Open a pull request to the `main` branch of the upstream repository.

## Development Setup

This project is a monorepo containing a `backend` (NestJS) and a `frontend` (Angular).

### Backend Setup

1.  Navigate to the backend directory: `cd backend`
2.  Install dependencies: `npm install`
3.  Configuration: Create a `.env` file from the `template-env` and fill in the variables.
4.  Run the backend: `npm run start:dev`
    The backend will be running in watch mode at `http://localhost:9999`.

### Frontend Setup

1.  Navigate to the frontend directory: `cd frontend`
2.  Install dependencies: `npm install`
3.  Run the frontend: `npm run start`
    The frontend development server will be running at `http://localhost:4200`.

## Running Tests

### Backend Tests

Navigate to the `backend` directory to run these commands.

*   **Run all unit tests**:
    ```bash
    npm run test
    ```
*   **Run all e2e tests**:
    ```bash
    npm run test:e2e
    ```
*   **Generate a merged coverage report**:
    ```bash
    npm run test:cov:all
    ```

### Frontend Tests

Navigate to the `frontend` directory to run these commands.

*   **Run all tests**:
    ```bash
    npm run test
    ```

## Coding Style

*   **Formatting**: We use [Prettier](https://prettier.io/) for automated code formatting. Please run `npm run format` before committing your changes.
*   **Linting**: We use [ESLint](https://eslint.org/) for identifying and reporting on patterns in JavaScript. Please run `npm run lint` to check your code.
*   **Comments**: For new features or complex logic, please add JSDoc-style comments to explain the *why* behind your code.

Thank you for your contribution!