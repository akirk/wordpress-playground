import { useState } from 'react';
import { external, trash } from '@wordpress/icons';
import { Icon } from '@wordpress/icons';
import { logger } from '@php-wasm/logger';
import { useActiveSite } from '../../lib/state/redux/store';
import { opfsSiteStorage } from '../../lib/state/opfs/opfs-site-storage';
import { WordPressIcon } from '@wp-playground/components';
import { BackupReminder } from '../backup-reminder';
import { TabInfoWindow } from '../tab-info-window';
import {
	Overlay,
	OverlayHeader,
	OverlayBody,
	OverlaySection,
} from '../overlay';
import css from './style.module.css';

type PluginBlueprint = {
	title: string;
	description: string;
	blueprint: object;
};

const pluginBlueprints: PluginBlueprint[] = [
	{
		title: 'RSS Reader',
		description:
			'Follow friends and consume their content in your WordPress',
		blueprint: {
			landingPage: '/friends/?refresh&welcome',
			steps: [
				{
					step: 'installPlugin',
					pluginData: {
						resource: 'wordpress.org/plugins',
						slug: 'friends',
					},
					options: {
						activate: true,
					},
				},
				{
					step: 'runPHP',
					code: "<?php require_once '/wordpress/wp-load.php';if(class_exists('Friends\\Import')){$feeds=array(array('https://alex.kirk.at','Alex Kirk'),array('https://adamadam.blog','Adam Zieliński'));$x=new SimpleXMLElement('<opml/>');$a='addAttribute';$c='addChild';$x->$a('version','2.0');$h=$x->$c('head');$h->$c('title','Subscriptions');$b=$x->$c('body');$s=$b->$c('outline');$s->$a('text','Subscriptions');$s->$a('title','Subscriptions');foreach($feeds as $f){list($u,$t)=$f;$o=$s->$c('outline');$o->$a('type','rss');$o->$a('text',$t);$o->$a('title',$t);$o->$a('xmlUrl',$u);$o->$a('htmlUrl',$u);}Friends\\Import::opml($x->asXML());}",
					progress: {
						caption: 'Importing feeds to Friends plugin',
					},
				},
			],
			$schema: 'https://playground.wordpress.net/blueprint-schema.json',
			meta: {
				title: 'Load Feeds into the Friends plugin',
				author: 'https://github.com/akirk/playground-step-library',
			},
		},
	},
	{
		title: 'Personal CRM',
		description:
			'Manage your contacts and relationships directly from WordPress',
		blueprint: {
			landingPage: '/crm/welcome',
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/pcrm-beeper.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'personal-crm/personal-crm.php',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'keeping-contact/keeping-contact.php',
				},
				{
					step: 'activatePlugin',
					pluginPath:
						'contact-sync-personal-crm/contact-sync-personal-crm.php',
				},
			],
		},
	},
	{
		title: 'Collect Posts from the Web',
		description:
			'Use the Post Collection Plugin to save articles from around the web',
		blueprint: {
			landingPage: '/wp-admin/admin.php?page=post-collection-settings',
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/post-collection.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'post-collection/post-collection.php',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'send-to-e-reader/send-to-e-reader.php',
				},
			],
		},
	},
	{
		title: 'Chat to Blog',
		description:
			'Import media from Beeper chats and create blog posts. Requires Beeper Desktop running.',
		blueprint: {
			landingPage: '/wp-admin/admin.php?page=chat-to-blog',
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/chat-to-blog.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'chat-to-blog/chat-to-blog.php',
				},
			],
		},
	},
	{
		title: 'AI Assistant',
		description:
			'AI-powered chat interface to modify your WordPress to your liking. Bring your own key or use a local LLM',
		blueprint: {
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/playground-ai-assistant.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath:
						'playground-ai-assistant/playground-ai-assistant.php',
				},
			],
		},
	},
	{
		title: 'App Launcher',
		description: 'Adds an app launcher to your WordPress',
		blueprint: {
			landingPage: '/wp-admin/options-general.php?page=my-apps',
			steps: [
				{
					step: 'installPlugin',
					pluginData: {
						resource: 'wordpress.org/plugins',
						slug: 'my-apps',
					},
					options: {
						activate: true,
					},
				},
			],
		},
	},
];

// Blueprint to install Health Check plugin and enable its troubleshooting mode.
// IMPORTANT: The login step must be LAST because it loads WordPress.
// The other steps run before WordPress boots, so the MU-plugin is in place
// before WordPress loads any plugins (including the crashing one).
//
// The Health Check MU-plugin requires a database option 'health-check-disable-plugin-hash'
// that matches: cookieValue + md5(REMOTE_ADDR). We add an earlier MU-plugin (alphabetically)
// that uses pre_option filter to return the expected hash, bypassing the database check.
const healthCheckRecoveryBlueprint = {
	steps: [
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'wordpress.org/plugins',
				slug: 'health-check',
			},
			options: {
				activate: false,
			},
		},
		{
			step: 'mkdir',
			path: '/wordpress/wp-content/mu-plugins',
		},
		{
			step: 'cp',
			fromPath:
				'/wordpress/wp-content/plugins/health-check/mu-plugin/health-check-troubleshooting-mode.php',
			toPath: '/wordpress/wp-content/mu-plugins/health-check-troubleshooting-mode.php',
		},
		{
			// Add an MU-plugin that loads before health-check (alphabetically: "0" < "h")
			// to provide the expected hash via pre_option filter
			step: 'writeFile',
			path: '/wordpress/wp-content/mu-plugins/0-health-check-hash-bypass.php',
			data: `<?php
// Bypass Health Check hash verification by setting both the GET param and option.
// Self-delete when user disables troubleshooting mode via Health Check UI.
if (isset($_GET['health-check-disable-troubleshooting'])) {
    @unlink(__FILE__);
} else {
    $_GET['health-check-disable-plugin-hash'] = 'playground-recovery';
    add_filter('pre_option_health-check-disable-plugin-hash', function() {
        return 'playground-recovery';
    });
    // Don't try to switch to a default theme
    add_filter('pre_option_health-check-default-theme', function() {
        return 'no';
    });
}
`,
		},
		{
			step: 'login',
		},
	],
	landingPage:
		'/wp-admin/site-health.php?tab=troubleshoot&health-check-disable-plugin-hash=playground-recovery',
};

function getBlueprintUrl(blueprint: object): string {
	const url = new URL(window.location.href);
	url.hash = '';
	const jsonStr = JSON.stringify(blueprint);
	const encoded = btoa(
		encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) =>
			String.fromCharCode(parseInt(p1, 16))
		)
	);
	url.searchParams.set(
		'blueprint-url',
		`data:application/json;base64,${encoded}`
	);
	return url.toString();
}

interface PersistentPlaygroundOverlayProps {
	onClose: () => void;
}

export function PersistentPlaygroundOverlay({
	onClose,
}: PersistentPlaygroundOverlayProps) {
	const activeSite = useActiveSite();

	const [showDeleteButton, setShowDeleteButton] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showRecoveryButton, setShowRecoveryButton] = useState(false);

	async function handleStartOver() {
		if (!activeSite || activeSite.metadata.storage === 'none') {
			return;
		}

		const proceed = window.confirm(
			'Are you sure you want to start over? This will delete all your data and reset WordPress to a fresh install.'
		);
		if (!proceed) {
			return;
		}

		setIsDeleting(true);
		try {
			await opfsSiteStorage?.delete(activeSite.slug);
			window.location.href =
				window.location.origin + window.location.pathname;
		} catch (error) {
			logger.error(error);
			alert('Failed to reset. Please try again.');
			setIsDeleting(false);
		}
	}

	return (
		<Overlay onClose={onClose}>
			<OverlayHeader onClose={onClose} />
			<OverlayBody>
				<TabInfoWindow />
				<OverlaySection title="Install Apps">
					<div className={css.featuresList}>
						{pluginBlueprints.map((plugin, index) => (
							<a
								key={index}
								className={css.featureItem}
								href={getBlueprintUrl(plugin.blueprint)}
							>
								<span className={css.featureIcon}>
									<WordPressIcon />
								</span>
								<span className={css.featureContent}>
									<span className={css.featureTitle}>
										{plugin.title}
									</span>
									<span className={css.featureDescription}>
										{plugin.description}
									</span>
								</span>
							</a>
						))}
					</div>
				</OverlaySection>

				<OverlaySection title="Backup">
					<BackupReminder />
				</OverlaySection>

				<div className={css.bottomRow}>
					<OverlaySection title="More Playgrounds">
						<p>
							Want multiple Playgrounds? Open temporary instances
							that reset on refresh.
						</p>
						<a
							href="https://playground.wordpress.net"
							target="_blank"
							rel="noopener noreferrer"
							className={css.externalLink}
						>
							<Icon icon={external} size={20} />
							<span>Open playground.wordpress.net</span>
						</a>
					</OverlaySection>

					<OverlaySection title="Start over">
						<p>
							If you want to start over,{' '}
							<button
								className={css.textButton}
								onClick={() =>
									setShowDeleteButton(!showDeleteButton)
								}
							>
								you can reset this WordPress
							</button>
							.
						</p>
						{showDeleteButton && (
							<button
								className={css.dangerButton}
								onClick={handleStartOver}
								disabled={isDeleting}
							>
								<Icon icon={trash} size={20} />
								<span>
									{isDeleting
										? 'Deleting...'
										: 'Delete everything'}
								</span>
							</button>
						)}
					</OverlaySection>
				</div>

				<OverlaySection title="Recovery">
					<p>
						If WordPress crashed,{' '}
						<button
							className={css.textButton}
							onClick={() =>
								setShowRecoveryButton(!showRecoveryButton)
							}
						>
							you can troubleshoot
						</button>
						.
					</p>
					{showRecoveryButton && (
						<a
							href={getBlueprintUrl(healthCheckRecoveryBlueprint)}
							className={css.primaryButton}
						>
							Install Health Check &amp; Troubleshoot
						</a>
					)}
				</OverlaySection>
			</OverlayBody>
		</Overlay>
	);
}
