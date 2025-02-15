import Docker from 'dockerode';
import redis from 'redis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const docker = new Docker({
  socketPath: '/var/run/docker.sock',
  timeout: 30000, // 30 saniye timeout
  version: 'v1.41', // API versiyonunu belirt
});
if (!process.env.WALLETS_PER_BALANCER) {
  throw new Error('WALLETS_PER_BALANCER is not set');
}
const WALLETS_PER_BALANCER = parseInt(process.env.WALLETS_PER_BALANCER);
const SERVICE_NAME = 'socket-balancer';

// Redis client setup
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});

const subscriber = redisClient.duplicate();

async function getCurrentBalancerCount() {
  try {
    const services = await docker.listServices({
      filters: { name: [SERVICE_NAME] },
    });

    if (services.length === 0) {
      console.log('No socket-balancer service found');
      return 0;
    }

    // Servis var, aktif task'ları kontrol et
    const service = services[0];
    const tasks = await docker.listTasks({
      filters: {
        service: [SERVICE_NAME],
        'desired-state': ['running'],
      },
    });

    console.log('Current running tasks:', tasks.length);
    console.log('Service replicas:', service.Spec?.Mode?.Replicated?.Replicas);

    if (!service.Spec?.Mode?.Replicated?.Replicas) {
      return 0;
    }

    return service.Spec.Mode.Replicated.Replicas;
  } catch (error) {
    console.error('Error getting current balancer count:', error);
    return 0;
  }
}

async function buildBalancerImage() {
  try {
    console.log('Building socket-balancer image...');

    // Önce çalışma dizinini görelim

    const buildContext = path.resolve('/app/socket-balancer');

    // Gerekli dosyaları kontrol et
    const files = [
      'Dockerfile',
      'package.json',
      'index.js',
      'config.js',
      'utils',
    ];

    // Build stream'ini al
    const stream = await docker.buildImage(
      {
        context: buildContext,
        src: files,
      },
      {
        t: 'socket-balancer:latest',
      }
    );

    // Build sürecini izle
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err, res) => {
          if (err) {
            console.error('Build error:', err);
            reject(err);
          } else {
            resolve(res);
          }
        },
        (event) => {
          if (event.stream) {
            process.stdout.write(event.stream);
          }
        }
      );
    });

    console.log('Socket-balancer image built successfully');
    return true;
  } catch (error) {
    console.error('Error building socket-balancer image:', error);
    return false;
  }
}

async function deployBalancerService(requiredBalancers) {
  try {
    console.log(
      `Deploying socket-balancer service with ${requiredBalancers} replicas...`
    );

    const serviceConfig = {
      Name: SERVICE_NAME,
      TaskTemplate: {
        ContainerSpec: {
          Image: 'socket-balancer:latest',
          Env: [
            `REDIS_URL=redis://redis:6379`,
            `SOLANA_RPC_WS=${process.env.SOLANA_RPC_WS}`,
            `SOLANA_RPC_HTTP=${process.env.SOLANA_RPC_HTTP}`,
            `USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
            `SOL_MINT=So11111111111111111111111111111111111111112`,
            `WALLETS_PER_BALANCER=${WALLETS_PER_BALANCER}`,
            'BALANCER_INDEX={{.Task.Slot}}',
          ],
          Labels: {
            'com.docker.stack.namespace': 'socket-balancer',
          },
          Name: 'socket-balancer-{{.Task.Slot}}',
          StopGracePeriod: 30000000000,
        },
        RestartPolicy: {
          Condition: 'on-failure',
          Delay: 5000000000,
          MaxAttempts: 3,
        },
        Networks: [
          {
            Target: 'socket-balancer-network',
          },
        ],
        Placement: {
          Constraints: ['node.role == manager'],
          MaxReplicas: 0,
        },
      },
      Mode: {
        Replicated: {
          Replicas: requiredBalancers,
        },
      },
      UpdateConfig: {
        Parallelism: 1,
        Delay: 10000000000,
        Order: 'start-first',
        FailureAction: 'rollback',
      },
      EndpointSpec: {
        Mode: 'vip',
      },
    };

    const services = await docker.listServices({
      filters: { name: [SERVICE_NAME] },
    });

    if (services.length > 0) {
      console.log('Existing service found, updating...');
      const service = docker.getService(SERVICE_NAME);
      await service.update({
        ...serviceConfig,
        version: services[0].Version.Index,
      });
      console.log('Socket-balancer service updated');

      // Servisi kontrol et
      const updatedService = await docker.getService(SERVICE_NAME).inspect();
      console.log('Updated service config:', {
        replicas: updatedService.Spec.Mode.Replicated.Replicas,
        image: updatedService.Spec.TaskTemplate.ContainerSpec.Image,
      });
    } else {
      console.log('No existing service, creating new...');
      await docker.createService(serviceConfig);
      console.log('Socket-balancer service created');

      // Yeni servisi kontrol et
      const newService = await docker.getService(SERVICE_NAME).inspect();
      console.log('New service config:', {
        replicas: newService.Spec.Mode.Replicated.Replicas,
        image: newService.Spec.TaskTemplate.ContainerSpec.Image,
      });
    }

    return true;
  } catch (error) {
    console.error('Error deploying balancer service:', error);
    return false;
  }
}

async function removeBalancerService() {
  try {
    const services = await docker.listServices({
      filters: { name: [SERVICE_NAME] },
    });

    if (services.length > 0) {
      const service = docker.getService(SERVICE_NAME);
      await service.remove();
      console.log('Socket-balancer service removed');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error removing balancer service:', error);
    return false;
  }
}

async function updateService(service, requiredBalancers) {
  try {
    console.log(
      `Updating balancer count from ${currentBalancers} to ${requiredBalancers}`
    );

    // Retry mekanizması ekle
    for (let i = 0; i < 3; i++) {
      try {
        await service.update({
          version: -1,
          Mode: {
            Replicated: {
              Replicas: requiredBalancers,
            },
          },
        });
        console.log(`Scaled balancers to ${requiredBalancers}`);
        return true;
      } catch (error) {
        console.error(`Update attempt ${i + 1} failed:`, error);
        if (i < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    return false;
  } catch (error) {
    console.error('Error updating service:', error);
    return false;
  }
}

async function updateBalancers() {
  try {
    const walletCount = await redisClient.sCard('wallets');
    const requiredBalancers =
      Math.ceil(walletCount / WALLETS_PER_BALANCER) || 0;

    // Önce mevcut servisleri kontrol et ve temizle
    const services = await docker.listServices({
      filters: { name: [SERVICE_NAME] },
    });

    // Eğer servis varsa ve wallet sayısı 0 ise veya yeni deployment yapılacaksa, önce temizle
    if (services.length > 0 && (walletCount === 0 || requiredBalancers === 0)) {
      console.log('Removing existing socket-balancer service...');
      await removeBalancerService();
      console.log('Existing service removed');
    }

    // Güncel durumu al
    const currentBalancers = await getCurrentBalancerCount();

    console.log({
      walletCount,
      requiredBalancers,
      currentBalancers,
    });

    // Wallet sayısı 0 ise ve servis temizlendiyse çık
    if (walletCount === 0) {
      console.log('No wallets exist, balancer service removed');
      return;
    }

    // Yeni servis oluştur veya güncelle
    if (requiredBalancers > 0) {
      if (currentBalancers === 0) {
        console.log('Building new balancer service...');
        const buildSuccess = await buildBalancerImage();
        if (!buildSuccess) {
          throw new Error('Failed to build socket-balancer image');
        }

        const deploySuccess = await deployBalancerService(requiredBalancers);
        if (!deploySuccess) {
          throw new Error('Failed to deploy socket-balancer service');
        }
        console.log(`Deployed ${requiredBalancers} new balancers`);
      } else if (requiredBalancers !== currentBalancers) {
        const service = docker.getService(SERVICE_NAME);
        const success = await updateService(service, requiredBalancers);
        if (!success) {
          console.log(
            'Service update failed after retries, trying to recreate...'
          );
          await removeBalancerService();
          const buildSuccess = await buildBalancerImage();
          if (buildSuccess) {
            await deployBalancerService(requiredBalancers);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error updating balancers:', error);
  }
}

async function initializeSwarm() {
  try {
    // Swarm durumunu kontrol et
    const swarmInspect = await docker.swarmInspect();
    console.log('Connected to Docker Swarm');

    // Network'ü kontrol et ve yoksa oluştur
    try {
      const networks = await docker.listNetworks({
        filters: { name: ['socket-balancer-network'] },
      });

      if (networks.length === 0) {
        // Network yoksa oluştur
        console.log('Creating overlay network...');
        await docker.createNetwork({
          Name: 'socket-balancer-network',
          Driver: 'overlay',
          Attachable: true,
          Scope: 'swarm',
          Labels: {
            'com.docker.stack.namespace': 'socket-balancer',
          },
          IPAM: {
            Driver: 'default',
          },
        });
        console.log('Network created successfully');
      } else {
        console.log('Using existing socket-balancer-network');
      }
    } catch (error) {
      console.error('Error managing network:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error connecting to Docker Swarm:', error);
    console.error(
      'Please make sure Docker Swarm is initialized with "docker swarm init"'
    );
    return false;
  }
}

async function main() {
  try {
    // Redis bağlantılarını kur
    await redisClient.connect();
    await subscriber.connect();
    console.log('Connected to Redis');

    // Swarm'ı başlat
    const swarmInitialized = await initializeSwarm();
    if (!swarmInitialized) {
      throw new Error('Failed to initialize Docker Swarm');
    }

    // Subscribe to wallet updates
    await subscriber.subscribe('wallet-updates', async () => {
      console.log('Wallet updates detected, checking balancer requirements...');
      await updateBalancers();
    });

    // Initial check
    await updateBalancers();
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main().catch(console.error);
