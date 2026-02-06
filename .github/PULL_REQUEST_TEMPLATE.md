## Description
<!-- Provide a clear and concise description of your changes -->

## Related Issue
<!-- Link to the issue this PR addresses, e.g., "Closes #123" or "Fixes #456" -->
Closes #

## Type of Change
<!-- Check all that apply -->
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Code refactoring
- [ ] Performance improvement
- [ ] Plugin development
- [ ] Tests

## Changes Made
<!-- List the key changes in this PR -->
- 
- 
- 

## Testing
<!-- Describe the testing you've done -->

### Test Environment
- **Node.js Version**: <!-- Run `node --version` -->
- **Operating System**: <!-- e.g., Ubuntu 22.04, macOS 14, Windows 11 -->

### Tests Run
<!-- Check all that apply and describe any manual testing -->
- [ ] Existing tests pass (`npm test`)
- [ ] New tests added for new functionality
- [ ] Manual testing completed
- [ ] Tested with relevant messaging channels (Telegram/WhatsApp/Discord)
- [ ] Tested browser-based skills
- [ ] Tested CLI/TUI interface

### Manual Testing Details
<!-- Describe your manual testing process -->
```
# Paste test commands and results here
```

## Security Considerations
<!-- Have you checked for security implications? -->
- [ ] No security implications
- [ ] Security review needed
- [ ] Secrets properly handled via ConfigManager
- [ ] Input validation added where needed
- [ ] No sensitive data in logs

## Plugin-Specific Checklist
<!-- If this PR involves plugins, complete this section -->
- [ ] Plugin follows the standard structure (name, description, usage, handler)
- [ ] Plugin uses `context.config.get()` for secrets
- [ ] Plugin uses `context.logger` for logging
- [ ] Plugin includes proper error handling
- [ ] Plugin tested with `orcbot push` command
- [ ] Plugin documentation added to SKILLS.md

## Code Quality
<!-- Ensure your code meets quality standards -->
- [ ] Code follows existing style conventions
- [ ] No commented-out code (unless with explanation)
- [ ] Added comments for complex logic
- [ ] Updated relevant documentation
- [ ] Removed debug console.logs
- [ ] TypeScript types properly defined

## Breaking Changes
<!-- If this is a breaking change, describe the impact -->

## Checklist
<!-- General checklist before submitting -->
- [ ] I have read the [Contributing Guidelines](https://github.com/fredabila/orcbot/blob/main/CONTRIBUTING.md)
- [ ] I have performed a self-review of my code
- [ ] I have commented my code where necessary
- [ ] My changes generate no new warnings
- [ ] I have updated the documentation accordingly
- [ ] My changes are minimal and focused on the issue

## Screenshots/Demo
<!-- If applicable, add screenshots or demo output showing your changes -->

## Additional Notes
<!-- Any additional information that reviewers should know -->
