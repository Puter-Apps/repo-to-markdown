const repoUrlInput = document.getElementById('repoUrl');
const concatenateBtn = document.getElementById('concatenateBtn');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const fileInfo = document.getElementById('fileInfo');
const repoStats = document.getElementById('repoStats');
const downloadSection = document.getElementById('downloadSection');
const downloadBtn = document.getElementById('downloadBtn');

let concatenatedContent = '';
let repoDetails = null;
let abortController = null;
const cancelBtn = document.getElementById('cancelBtn');

// Collapsible skip patterns
const skipPatternsHeader = document.getElementById('skipPatternsHeader');
const skipPatternsContent = document.getElementById('skipPatternsContent');
const skipPatternsToggle = document.getElementById('skipPatternsToggle');
const skipPatternsCount = document.getElementById('skipPatternsCount');
const skipPatternsTextarea = document.getElementById('skipPatterns');

function updateSkipPatternsCount() {
    const patterns = skipPatternsTextarea.value.split('\n').filter(p => p.trim()).length;
    const isExpanded = skipPatternsContent.classList.contains('expanded');
    
    if (isExpanded) {
        skipPatternsCount.textContent = 'Click to collapse';
    } else {
        skipPatternsCount.textContent = `${patterns} patterns configured - Click to expand and edit`;
    }
}

function toggleSkipPatterns() {
    const isExpanded = skipPatternsContent.classList.contains('expanded');
    
    if (isExpanded) {
        // Collapse
        skipPatternsContent.classList.remove('expanded');
        skipPatternsHeader.classList.remove('active');
        skipPatternsToggle.classList.remove('expanded');
        updateSkipPatternsCount();
    } else {
        // Expand
        skipPatternsContent.classList.add('expanded');
        skipPatternsHeader.classList.add('active');
        skipPatternsToggle.classList.add('expanded');
        skipPatternsCount.textContent = 'Click to collapse';
    }
}

function showStatus(message, type) {
    // Use innerHTML if message contains SVG, otherwise use textContent for safety
    if (message.includes('<svg')) {
        statusDiv.innerHTML = message;
    } else {
        statusDiv.textContent = message;
    }
    statusDiv.className = `status-bar ${type}`;
    statusDiv.style.display = 'block';
}

function hideStatus() {
    statusDiv.style.display = 'none';
}

function updateProgress(current, total) {
    const percentage = (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
    progressContainer.style.display = 'block';
}

function hideProgress() {
    progressContainer.style.display = 'none';
}

function cancelOperation() {
    if (abortController) {
        abortController.abort();
        hideStatus();
        resetUIState();
    }
}

function resetUIState() {
    concatenateBtn.innerHTML = '<span>Convert to Markdown</span>';
    concatenateBtn.disabled = false;
    repoUrlInput.disabled = false;
    cancelBtn.style.display = 'none';
    hideProgress();
}

async function getRepositoryFiles(repoUrlString) {
    try {
        console.log(`Fetching files from: ${repoUrlString}`);
        
        let owner, repo;
        
        // Check if it's a full URL or just owner/repo format
        if (repoUrlString.includes('github.com')) {
            // Full URL format
            const urlParts = new URL(repoUrlString);
            const pathParts = urlParts.pathname.split('/').filter(part => part);
            if (pathParts.length < 2) {
                throw new Error('Invalid GitHub URL format. Please provide a valid repository URL.');
            }
            owner = pathParts[0];
            repo = pathParts[1].replace(/\.git$/, '');
        } else {
            // Simple owner/repo format
            const parts = repoUrlString.split('/');
            if (parts.length !== 2) {
                throw new Error('Invalid repository format. Please use "owner/repository" format.');
            }
            owner = parts[0];
            repo = parts[1];
        }
        
        const branchesToTry = ['main', 'master', 'dev', 'develop'];
        let workingBranch = null;
        let filesList = [];
        
        for (const branch of branchesToTry) {
            try {
                const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
                const treeResponse = await fetch(apiUrl, { signal: abortController?.signal });
                
                if (treeResponse.ok) {
                    const treeData = await treeResponse.json();
                    if (treeData.tree && treeData.tree.length > 0) {
                        workingBranch = branch;
                        filesList = treeData.tree.filter(item => item.type === 'blob');
                        break;
                    }
                }
            } catch (branchError) {
                if (branchError.name === 'AbortError') {
                    throw new Error('Operation cancelled');
                }
                continue;
            }
        }
        
        if (!workingBranch) {
            throw new Error(`Could not access repository "${owner}/${repo}". Please verify the repository exists and is public.`);
        }
        
        if (filesList.length === 0) {
            throw new Error(`Repository "${owner}/${repo}" appears to be empty.`);
        }
        
        return {
            files: filesList,
            owner: owner,
            repo: repo,
            branch: workingBranch,
            originalUrl: repoUrlString
        };
        
    } catch (error) {
        console.error('Error in getRepositoryFiles:', error);
        throw error;
    }
}

function isBinaryFile(filename) {
    const binaryExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.rar', '.7z', '.tar', '.gz', '.exe', '.dll',
        '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite',
        '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
        '.ttf', '.otf', '.woff', '.woff2', '.eot'
    ];
    
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return binaryExtensions.includes(ext);
}

function matchesGlob(filename, pattern) {
    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\//g, '\\/');
    
    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return regex.test(filename) || filename.includes(pattern.toLowerCase());
}

function shouldSkipFile(file, options) {
    const filename = file.path.toLowerCase();
    const basename = filename.split('/').pop();
    
    // Skip large files if option is enabled
    if (options.skipLargeFiles && file.size > 1024 * 1024) { // 1MB
        return true;
    }
    
    // Check against user-defined skip patterns
    if (options.skipPatterns && options.skipPatterns.length > 0) {
        for (const pattern of options.skipPatterns) {
            if (matchesGlob(filename, pattern) || matchesGlob(basename, pattern)) {
                return true;
            }
        }
    }
    
    return false;
}

function removeLicenseHeaders(content) {
    // Simple license header removal using basic string operations
    let cleanContent = content;
    
    // Check if content starts with common license indicators
    const licenseKeywords = ['license', 'copyright', 'mit', 'apache', 'gpl', 'bsd'];
    const lines = cleanContent.split('\n');
    let startIndex = 0;
    
    // Look for license headers in the first 20 lines
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        const line = lines[i].toLowerCase();
        
        // If line contains license keywords, mark it for removal
        if (licenseKeywords.some(keyword => line.includes(keyword))) {
            // Find the end of the license block
            if (line.includes('*/') || line.includes('-->')) {
                startIndex = i + 1;
                break;
            }
            // For single line comments, just remove this line
            if (line.startsWith('//') || line.startsWith('#')) {
                startIndex = i + 1;
                break;
            }
        }
        
        // If we encounter actual code (not comments), stop looking
        if (line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('#') && !line.trim().startsWith('/*') && !line.trim().startsWith('*') && !line.trim().startsWith('<!--')) {
            break;
        }
    }
    
    // Remove the license header lines
    if (startIndex > 0) {
        cleanContent = lines.slice(startIndex).join('\n');
    }
    
    // Remove excessive blank lines at the beginning
    cleanContent = cleanContent.replace(/^\s*\n+/, '');
    
    return cleanContent;
}

async function downloadAndConcatenateFiles(repoData, options) {
    let content = '';
    let processedFiles = 0;
    let skippedFiles = 0;
    let totalSize = 0;
    
    const filesToProcess = repoData.files.filter(file => !shouldSkipFile(file, options));
    
    if (filesToProcess.length === 0) {
        throw new Error('No files to process after applying filters.');
    }
    
    showStatus(`Processing ${filesToProcess.length} files...`, 'info');
    
    for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        updateProgress(i + 1, filesToProcess.length);
        
        try {
            const rawUrl = `https://raw.githubusercontent.com/${repoData.owner}/${repoData.repo}/${repoData.branch}/${file.path}`;
            
            showStatus(`(${i + 1}/${filesToProcess.length}) Downloading ${file.path}`, 'info');
            
            const response = await fetch(rawUrl, { signal: abortController?.signal });
            if (response.ok) {
                let fileContent = await response.text();
                
                // Remove license headers if option is enabled
                if (options.removeLicenseHeaders) {
                    fileContent = removeLicenseHeaders(fileContent);
                }
                
                if (options.addSeparators) {
                    content += `${'='.repeat(80)}\n`;
                }
                
                if (options.includeFilenames) {
                    content += `// File: ${file.path}\n`;
                    if (options.addSeparators) {
                        content += `${'='.repeat(80)}\n`;
                    }
                }
                
                content += fileContent;
                
                if (!fileContent.endsWith('\n')) {
                    content += '\n';
                }
                
                if (options.addSeparators) {
                    content += '\n';
                }
                
                processedFiles++;
                totalSize += fileContent.length;
                
            } else {
                console.warn(`Could not download ${file.path}: HTTP ${response.status}`);
                skippedFiles++;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Operation cancelled');
            }
            console.error(`Error downloading ${file.path}:`, error);
            skippedFiles++;
        }
    }
    
    hideProgress();
    
    // Update stats
    repoStats.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${processedFiles}</div>
            <div class="stat-label">Files Processed</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${skippedFiles}</div>
            <div class="stat-label">Files Skipped</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${(totalSize / 1024).toFixed(1)}KB</div>
            <div class="stat-label">Total Size</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${repoData.files.length}</div>
            <div class="stat-label">Total Files</div>
        </div>
    `;
    
    fileInfo.style.display = 'block';
    
    return {
        content: content,
        stats: {
            processed: processedFiles,
            skipped: skippedFiles,
            totalSize: totalSize
        }
    };
}

async function concatenateRepository(repoUrlString) {
    const originalBtnHTML = concatenateBtn.innerHTML;
    
    try {
        // Create new AbortController for this operation
        abortController = new AbortController();
        
        concatenateBtn.disabled = true;
        repoUrlInput.disabled = true;
        cancelBtn.style.display = 'block';
        downloadSection.style.display = 'none';
        fileInfo.style.display = 'none';
        hideProgress();

        concatenateBtn.innerHTML = '<span class="loading-spinner"></span>Fetching repository data...';
        showStatus('Fetching repository data...', 'info');
        
        const repoData = await getRepositoryFiles(repoUrlString);
        repoDetails = repoData;
        
        const options = {
            includeFilenames: true, // Always true
            addSeparators: true, // Always true
            skipLargeFiles: document.getElementById('skipLargeFiles').checked,
            removeLicenseHeaders: document.getElementById('removeLicenseHeaders').checked,
            skipPatterns: document.getElementById('skipPatterns').value.split('\n').filter(p => p.trim()).map(p => p.trim())
        };
        
        concatenateBtn.innerHTML = '<span class="loading-spinner"></span>Processing files...';
        
        const result = await downloadAndConcatenateFiles(repoData, options);
        concatenatedContent = result.content;
        
        showStatus(`<svg style="margin-right: 5px; margin-bottom: -3px;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-circle" viewBox="0 0 16 16"> <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/> <path d="m10.97 4.97-.02.022-3.473 4.425-2.093-2.094a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05"/> </svg>Successfully processed ${result.stats.processed} files!`, 'success');
        downloadSection.style.display = 'block';
        
    } catch (error) {
        if (error.message === 'Operation cancelled') {
            // Don't show error status if user cancelled - it's already shown
            return;
        }
        showStatus(`❌ Error: ${error.message}`, 'error');
        console.error('Concatenation error:', error);
    } finally {
        concatenateBtn.innerHTML = originalBtnHTML;
        concatenateBtn.disabled = false;
        repoUrlInput.disabled = false;
        cancelBtn.style.display = 'none';
        abortController = null;
    }
}

function downloadConcatenatedFile() {
    if (!concatenatedContent || !repoDetails) {
        showStatus('❌ No content to download', 'error');
        return;
    }
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `${repoDetails.owner}-${repoDetails.repo}-${timestamp}.md`;
    
    const blob = new Blob([concatenatedContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus(`Downloaded ${filename}`, 'success');
}

// Event listeners
document.getElementById('concatenateForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    hideStatus();
    
    const repoUrl = repoUrlInput.value.trim();
    if (!repoUrl) {
        showStatus('Please enter a GitHub repository URL.', 'error');
        return;
    }

    // Validate input format
    const isUrl = repoUrl.includes('github.com');
    const isRepoFormat = repoUrl.includes('/') && !repoUrl.includes('github.com');
    
    if (!isUrl && !isRepoFormat) {
        showStatus('Please enter a valid GitHub repository URL (e.g., https://github.com/username/repository or username/repository).', 'error');
        return;
    }

    await concatenateRepository(repoUrl);
});

downloadBtn.addEventListener('click', downloadConcatenatedFile);

cancelBtn.addEventListener('click', cancelOperation);

// Collapsible skip patterns event listeners
skipPatternsHeader.addEventListener('click', toggleSkipPatterns);
skipPatternsTextarea.addEventListener('input', updateSkipPatternsCount);

// Initialize
hideStatus();
updateSkipPatternsCount();