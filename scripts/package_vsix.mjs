import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const stagingDir = path.join(rootDir, 'dist_vsix');

// Read package.json for version & metadata
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outVsix = path.join(rootDir, `${pkg.name}-${pkg.version}.vsix`);
const binariesDir = path.join(rootDir, 'binaries');

// 1. Clean staging directory
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
if (fs.existsSync(outVsix)) {
  fs.unlinkSync(outVsix);
}

fs.mkdirSync(stagingDir, { recursive: true });

// 2. Create [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="txt" ContentType="text/plain"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
</Types>`;
fs.writeFileSync(path.join(stagingDir, '[Content_Types].xml'), contentTypesXml, 'utf8');

// 3. Create extension.vsixmanifest
const iconMetadata = pkg.icon ? `\n\t\t<Icon>extension/${pkg.icon}</Icon>` : '';
const iconAsset = pkg.icon ? `\n\t\t<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${pkg.icon}" Addressable="true" />` : '';
const tagsString = Array.isArray(pkg.keywords) ? pkg.keywords.join(',') : '';
const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url || '');
const homepageUrl = pkg.homepage || '';
const bugsUrl = typeof pkg.bugs === 'string' ? pkg.bugs : (pkg.bugs?.url || '');
const hasChangelog = fs.existsSync(path.join(rootDir, 'Changelog.md')) || fs.existsSync(path.join(rootDir, 'CHANGELOG.md'));
const changelogAsset = hasChangelog ? `\n\t\t<Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md" Addressable="true" />` : '';

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
		<DisplayName>${pkg.displayName}</DisplayName>
		<Description xml:space="preserve">${pkg.description}</Description>
		<Tags>${tagsString}</Tags>
		<Categories>${pkg.categories ? pkg.categories.join(',') : 'Other'}</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines?.vscode || '^1.75.0'}" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
			<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>${repoUrl ? `\n\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${repoUrl}" />\n\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="${repoUrl}" />\n\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="${repoUrl}" />` : ''}${bugsUrl ? `\n\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="${bugsUrl}" />` : ''}${homepageUrl ? `\n\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="${homepageUrl}" />` : ''}
		</Properties>
		<License>extension/LICENSE.txt</License>${iconMetadata}
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code"/>
	</Installation>
	<Dependencies/>
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />${changelogAsset}
		<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />${iconAsset}
	</Assets>
</PackageManifest>`;
fs.writeFileSync(path.join(stagingDir, 'extension.vsixmanifest'), vsixManifest, 'utf8');

// 4. Copy extension directory contents
const extDir = path.join(stagingDir, 'extension');
fs.mkdirSync(extDir, { recursive: true });

// Copy package.json
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(extDir, 'package.json'));

// Copy LICENSE
if (fs.existsSync(path.join(rootDir, 'LICENSE'))) {
  fs.copyFileSync(path.join(rootDir, 'LICENSE'), path.join(extDir, 'LICENSE.txt'));
} else if (fs.existsSync(path.join(rootDir, 'LICENSE.txt'))) {
  fs.copyFileSync(path.join(rootDir, 'LICENSE.txt'), path.join(extDir, 'LICENSE.txt'));
}

// Copy README
if (fs.existsSync(path.join(rootDir, 'README.md'))) {
  fs.copyFileSync(path.join(rootDir, 'README.md'), path.join(extDir, 'readme.md'));
}

// Copy Changelog
if (fs.existsSync(path.join(rootDir, 'Changelog.md'))) {
  fs.copyFileSync(path.join(rootDir, 'Changelog.md'), path.join(extDir, 'changelog.md'));
} else if (fs.existsSync(path.join(rootDir, 'CHANGELOG.md'))) {
  fs.copyFileSync(path.join(rootDir, 'CHANGELOG.md'), path.join(extDir, 'changelog.md'));
}

// Copy icon if at root
if (pkg.icon && fs.existsSync(path.join(rootDir, pkg.icon))) {
  const iconDest = path.join(extDir, pkg.icon);
  fs.mkdirSync(path.dirname(iconDest), { recursive: true });
  fs.copyFileSync(path.join(rootDir, pkg.icon), iconDest);
}

// Copy dist directory recursively
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!entry.name.endsWith('.map') && !entry.name.endsWith('.tsbuildinfo')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(path.join(rootDir, 'dist'))) {
  copyDirRecursive(path.join(rootDir, 'dist'), path.join(extDir, 'dist'));
}

// 5. Zip into VSIX using zip command (with -X to exclude OS extra file attributes for Open VSX compliance)
execSync(`cd "${stagingDir}" && zip -X -q -r "${outVsix}" .`, { stdio: 'inherit' });

// Also copy into binaries/ directory to maintain historical convention
fs.mkdirSync(binariesDir, { recursive: true });
fs.copyFileSync(outVsix, path.join(binariesDir, path.basename(outVsix)));

// 6. Cleanup staging directory
fs.rmSync(stagingDir, { recursive: true, force: true });

console.log(`\n🎉 Successfully packaged ${pkg.displayName} v${pkg.version} into:\n   ${outVsix}\n   ${path.join(binariesDir, path.basename(outVsix))}\n`);
