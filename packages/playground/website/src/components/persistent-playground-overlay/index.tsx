import { useState, useEffect } from 'react';
import { external, trash } from '@wordpress/icons';
import { Icon } from '@wordpress/icons';
import { logger } from '@php-wasm/logger';
import { useActiveSite } from '../../lib/state/redux/store';
import { opfsSiteStorage } from '../../lib/state/opfs/opfs-site-storage';
import { WordPressIcon } from '@wp-playground/components';
import { BackupReminder } from '../backup-reminder';
import { PluginList } from '../plugin-list';
import { usePlaygroundClient } from '../../lib/use-playground-client';
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
				{
					step: 'activatePlugin',
					pluginPath: 'a8c-team/a8c-team.php',
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
		description: 'Import media from Beeper chats and create blog posts',
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
			'AI-powered chat interface to modify your WordPress to your liking',
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
];

interface PersistentPlaygroundOverlayProps {
	onClose: () => void;
}

export function PersistentPlaygroundOverlay({
	onClose,
}: PersistentPlaygroundOverlayProps) {
	const activeSite = useActiveSite();
	const playground = usePlaygroundClient();

	const [showDeleteButton, setShowDeleteButton] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const [activePlugins, setActivePlugins] = useState<string[]>([]);
	const [isLoadingPlugins, setIsLoadingPlugins] = useState(true);
	const [pluginNames, setPluginNames] = useState<Record<string, string>>({});
	const [wpSiteName, setWpSiteName] = useState<string | null>(null);

	useEffect(() => {
		if (!playground) {
			return;
		}
		const client = playground;
		async function fetchSiteData() {
			try {
				const response = await client.run({
					code: `<?php
						// Prevent plugins from loading
						define('WP_INSTALLING', true);
						require_once '/wordpress/wp-load.php';
						require_once ABSPATH . 'wp-admin/includes/plugin.php';

						$active = get_option('active_plugins', []);
						$plugins = [];

						foreach ($active as $plugin_file) {
							$plugin_path = WP_PLUGIN_DIR . '/' . $plugin_file;
							if (file_exists($plugin_path)) {
								$data = get_plugin_data($plugin_path, false, false);
								$plugins[$plugin_file] = $data['Name'] ?: $plugin_file;
							} else {
								$plugins[$plugin_file] = $plugin_file;
							}
						}

						echo json_encode([
							'siteName' => html_entity_decode(get_option('blogname', 'WordPress')),
							'plugins' => $plugins,
						]);
					`,
				});
				const data = JSON.parse(response.text);
				setActivePlugins(Object.keys(data.plugins));
				setPluginNames(data.plugins);
				setWpSiteName(data.siteName);
			} catch (error) {
				logger.error('Failed to fetch site data:', error);
				setActivePlugins([]);
			} finally {
				setIsLoadingPlugins(false);
			}
		}
		fetchSiteData();
	}, [playground]);

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
				<OverlaySection title="Install Apps">
					<div className={css.featuresList}>
						{pluginBlueprints.map((plugin, index) => {
							const url = new URL(window.location.href);
							url.hash = '';
							const jsonStr = JSON.stringify(plugin.blueprint);
							const encoded = btoa(
								encodeURIComponent(jsonStr).replace(
									/%([0-9A-F]{2})/g,
									(_, p1) =>
										String.fromCharCode(parseInt(p1, 16))
								)
							);
							url.searchParams.set(
								'blueprint-url',
								`data:application/json;base64,${encoded}`
							);
							return (
								<a
									key={index}
									className={css.featureItem}
									href={url.toString()}
								>
									<span className={css.featureIcon}>
										<WordPressIcon />
									</span>
									<span className={css.featureContent}>
										<span className={css.featureTitle}>
											{plugin.title}
										</span>
										<span
											className={css.featureDescription}
										>
											{plugin.description}
										</span>
									</span>
								</a>
							);
						})}
					</div>
				</OverlaySection>

				<OverlaySection title="Backup">
					<BackupReminder wpSiteName={wpSiteName} />
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
					<PluginList
						activePlugins={activePlugins}
						pluginNames={pluginNames}
						isLoading={isLoadingPlugins}
					/>
				</OverlaySection>
			</OverlayBody>
		</Overlay>
	);
}
