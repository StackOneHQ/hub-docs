#!/usr/bin/env python3
import os
import re
from pathlib import Path

def analyze_mdx_file(file_path):
    """Analyze an MDX file for compliance with required format."""
    issues = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        issues.append(f"Could not read file: {e}")
        return issues
    
    # Check frontmatter
    frontmatter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not frontmatter_match:
        issues.append("Missing frontmatter")
    else:
        frontmatter = frontmatter_match.group(1)
        
        # Check title format
        title_match = re.search(r'title:\s*["\']([^"\']+)["\']', frontmatter)
        if not title_match:
            issues.append("Missing or incorrectly formatted title")
        else:
            title = title_match.group(1)
        
        # Check description format
        desc_match = re.search(r'description:\s*["\']([^"\']+)["\']', frontmatter)
        if not desc_match:
            issues.append("Missing description")
        else:
            desc = desc_match.group(1)
            expected_desc = f"Follow these steps to connect {title} via the StackOne Hub successfully."
            if desc != expected_desc and not desc.startswith("Follow these steps to connect"):
                issues.append(f"Incorrect description format. Expected: '{expected_desc}', Got: '{desc}'")
    
    # Check for required imports
    if 'import IntegrationFooter from "/snippets/integration-footer.mdx"' not in content:
        issues.append("Missing IntegrationFooter import")
    
    # Check for Warning section
    if '<Warning>' not in content:
        issues.append("Missing Warning section")
    
    # Check for Steps component
    if '<Steps>' not in content:
        issues.append("Missing Steps component")
    
    # Check for IntegrationFooter component
    if '<IntegrationFooter />' not in content:
        issues.append("Missing IntegrationFooter component")
    
    # Check for "Linking your {Provider} Account" section
    if title_match:
        provider = title_match.group(1)
        linking_pattern = f"## Linking your {provider} Account"
        if linking_pattern not in content and "## Linking your Account" not in content and "## Connecting to StackOne" not in content and "## Connect with StackOne" not in content and "## Connecting with StackOne" not in content:
            issues.append(f"Missing 'Linking your {provider} Account' section")
    
    # Check for "Available data" section
    if '## Available data' not in content:
        issues.append("Missing 'Available data' section")
    
    # Check for "Useful Links" section (optional but recommended)
    if '## Useful Links' not in content:
        issues.append("Missing 'Useful Links' section (recommended)")
    
    return issues

def is_simple_connect_guide(file_path):
    """Check if this is a simple connect account guide that should be excluded."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return False
    
    # Check for patterns that indicate simple connect guides
    simple_patterns = [
        'Click Connect Account',
        'In the modal, click the Connect button',
        'Click the Connect button',
    ]
    
    # If it has multiple steps or authentication sections, it's not simple
    if content.count('<Step') > 3:
        return False
    
    if any(pattern in content for pattern in simple_patterns):
        # But check if it has actual authentication steps
        auth_keywords = ['API Key', 'Client ID', 'Client Secret', 'OAuth', 'Token', 'Credentials']
        if not any(keyword in content for keyword in auth_keywords):
            return True
    
    return False

def main():
    base_path = Path('/home/runner/work/hub-docs/hub-docs/connection-guides')
    
    # Find all MDX files
    mdx_files = []
    for root, dirs, files in os.walk(base_path):
        for file in files:
            if file.endswith('.mdx') and file != 'introduction.mdx':
                mdx_files.append(Path(root) / file)
    
    print(f"Found {len(mdx_files)} MDX files to analyze.\n")
    
    compliant_files = []
    non_compliant_files = []
    simple_connect_guides = []
    
    for file_path in sorted(mdx_files):
        relative_path = file_path.relative_to(Path('/home/runner/work/hub-docs/hub-docs'))
        
        # Check if it's a simple connect guide
        if is_simple_connect_guide(file_path):
            simple_connect_guides.append(str(relative_path))
            continue
            
        # Analyze the file
        issues = analyze_mdx_file(file_path)
        
        if not issues:
            compliant_files.append(str(relative_path))
        else:
            non_compliant_files.append({
                'path': str(relative_path),
                'issues': issues
            })
    
    # Print results
    print("=== ANALYSIS RESULTS ===\n")
    
    print(f"EXCLUDED (Simple Connect Guides): {len(simple_connect_guides)}")
    for file in simple_connect_guides:
        print(f"  - {file}")
    print()
    
    print(f"COMPLIANT FILES: {len(compliant_files)}")
    for file in compliant_files:
        print(f"  - {file}")
    print()
    
    print(f"NON-COMPLIANT FILES REQUIRING UPDATES: {len(non_compliant_files)}")
    for file_info in non_compliant_files:
        print(f"\n📄 {file_info['path']}")
        for issue in file_info['issues']:
            print(f"   ❌ {issue}")
    
    print(f"\n=== SUMMARY ===")
    print(f"Total files analyzed: {len(mdx_files)}")
    print(f"Simple connect guides (excluded): {len(simple_connect_guides)}")
    print(f"Compliant files: {len(compliant_files)}")
    print(f"Files needing updates: {len(non_compliant_files)}")

if __name__ == "__main__":
    main()